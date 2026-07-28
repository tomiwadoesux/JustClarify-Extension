"""
Round-trip check for the shared errata cache.

Run this after setting SUPABASE_URL and SUPABASE_SERVICE_KEY to confirm the
backend can actually reach the tables. It writes a row under a throwaway URL,
reads it back, checks that uncacheable verdicts were filtered out, and deletes
what it made.

    ./venv/bin/python scripts/check_cache.py

Exits non-zero on the first failure, so it also works as a deploy smoke test.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from dotenv import load_dotenv

load_dotenv()

from app import errata  # noqa: E402  (must follow load_dotenv)

PROBE_URL = "https://justclarify.invalid/__cache_selftest__"

# Three verdicts in, two out: the transient one must be filtered by is_cacheable.
VERDICTS = [
    {"claim": "A checkable claim.", "verdict": "FALSE", "confidence": "high",
     "summary": "Contradicted by the source.", "sources": [], "origin": "searched",
     "quote": "A checkable claim."},
    {"claim": "A published ruling.", "verdict": "MOSTLY_FALSE", "confidence": "low",
     "summary": "PolitiFact rated this Mostly False.", "sources": [], "origin": "published",
     "quote": "A published ruling."},
    {"claim": "This one failed to check.", "verdict": "UNVERIFIABLE", "confidence": "low",
     "summary": "Couldn't complete the check.", "sources": [], "origin": "error",
     "quote": "This one failed to check."},
]

passed = 0


def check(label, ok, detail=""):
    global passed
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")
    if not ok:
        sys.exit(1)
    passed += 1


print("\nShared errata cache — round-trip check\n")

check("SUPABASE_URL set", bool(errata.SUPABASE_URL), errata.SUPABASE_URL or "missing")
check("SUPABASE_SERVICE_KEY set", bool(errata.SUPABASE_SERVICE_KEY),
      "hidden" if errata.SUPABASE_SERVICE_KEY else "missing — Dashboard > Project Settings > API Keys > service_role")

url_key = errata.normalize_url(PROBE_URL)
chash = errata.content_hash("Body text for the cache self-test.")

errata.store(url_key, chash, VERDICTS, model="selftest", title="Self test")
row = errata.fetch(url_key, chash)

check("row written and read back", row is not None,
      "if this failed, the key is probably the anon key — RLS rejects it by design")
check("fresh row is not stale", not row["stale"])
check("transient verdict filtered out", len(row["verdicts"]) == 2,
      f"stored {len(row['verdicts'])} of {len(VERDICTS)}")
check("low-confidence published ruling kept",
      any(v["origin"] == "published" for v in row["verdicts"]))
check("error-origin verdict dropped",
      not any(v["origin"] == "error" for v in row["verdicts"]))

# Same key again must update in place rather than duplicate.
errata.store(url_key, chash, VERDICTS[:1], model="selftest2", title="Self test 2")
again = errata.fetch(url_key, chash)
check("re-store updates in place", again is not None and len(again["verdicts"]) == 1,
      "upsert conflicted on (url_key, content_hash) as intended")

# Clean up.
requests.delete(
    f"{errata.SUPABASE_URL}/rest/v1/{errata.ERRATA_TABLE}",
    headers={
        "apikey": errata.SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {errata.SUPABASE_SERVICE_KEY}",
        "Prefer": "return=minimal",
    },
    params={"url_key": f"eq.{url_key}"},
    timeout=8,
)
check("test row cleaned up", errata.fetch(url_key, chash) is None)

print(f"\n{passed}/{passed} checks passed — the cache is live.\n")
