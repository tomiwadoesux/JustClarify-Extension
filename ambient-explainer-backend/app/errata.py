"""
Shared errata cache — the store behind "check this article once, serve it to
everyone".

A verdict belongs to a piece of writing, not to the reader who happened to
trigger the check. So the cache key is the article itself: a normalized URL plus
a hash of its text. That pairing is what makes the cache both wide and honest —
the URL groups readers onto the same row, and the hash means an edited article
stops matching and gets re-checked on its own, with no invalidation to remember.

Storage goes through Supabase's PostgREST endpoint rather than a direct Postgres
connection. On Vercel every request may land in a fresh execution context, and
handing each one a real database connection is how serverless apps exhaust a
connection pool. HTTP has no pool to exhaust.
"""

import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

ERRATA_TABLE = "errata"

# How long a verdict stays servable. Facts don't change, but the evidence about
# them does — a ruling made before the follow-up reporting landed is worse than
# no ruling, because it reads as current. Two weeks is short enough that a
# developing story re-checks itself and long enough that the cache still pays.
ERRATA_TTL_DAYS = int(os.getenv("ERRATA_TTL_DAYS", "14"))

# Query params that identify the *reader*, not the article. Left in, they'd
# split one article into a thousand cache rows and the hit rate would collapse.
TRACKING_PARAMS = re.compile(
    r"^(utm_|fbclid|gclid|dclid|msclkid|mc_[ce]id|igshid|si$|ref$|ref_src$|"
    r"source$|spm$|_hsenc|_hsmi|vero_|yclid|twclid|at_medium|at_campaign)",
    re.I,
)


def normalize_url(url: str) -> str:
    """
    Collapse the many URLs that point at one article into a single cache key.

    Deliberately conservative: path and meaningful query params are preserved,
    because `?page=2` and `?id=44` are different articles. Only the parts that
    are known to be about tracking or in-page position get dropped.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "https://" + raw

    try:
        parts = urlsplit(raw)
    except ValueError:
        return ""

    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return ""

    # Non-default ports are part of the identity; default ones are noise.
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"

    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not TRACKING_PARAMS.match(k)]
    kept.sort()

    path = parts.path or "/"
    if len(path) > 1:
        path = path.rstrip("/") or "/"

    # Fragment dropped entirely — it scrolls, it doesn't identify.
    return urlunsplit(("https", host, path, urlencode(kept), ""))


def content_hash(text: str) -> str:
    """
    Fingerprint the article body so an edit invalidates the cache by itself.

    Whitespace and case are normalized out first: a CMS re-wrapping a paragraph
    or a template changing indentation is not a change to the article, and
    treating it as one would throw away a perfectly good verdict.
    """
    normalized = re.sub(r"\s+", " ", (text or "")).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _headers(extra: dict | None = None) -> dict:
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def _rest_url(path: str) -> str:
    return f"{SUPABASE_URL}/rest/v1/{path}"


# ---------- Verdicts worth keeping ----------

# Origins that describe a failure to check rather than the result of one.
# Caching these would freeze a transient outage — a reader offline for ten
# seconds would poison the row for everyone else for two weeks.
TRANSIENT_ORIGINS = {"error", "no-key", "lookup-failed"}


def is_cacheable(verdict: dict) -> bool:
    """
    A shared cache multiplies whatever you put in it, mistakes included. One
    wrong verdict seen once is a bad answer; the same verdict cached is a bad
    answer shown to every future reader of that page. So the bar to enter the
    cache is higher than the bar to show something live.
    """
    if not isinstance(verdict, dict):
        return False
    if verdict.get("origin") in TRANSIENT_ORIGINS:
        return False
    # A published human ruling is the strongest evidence there is; keep it even
    # if the model downstream was unsure.
    if verdict.get("origin") == "published":
        return True
    if verdict.get("confidence") == "low":
        return False
    # Nothing to show and no sources to click is not worth a row.
    return bool(str(verdict.get("summary") or "").strip())


# ---------- Read / write ----------

def fetch(url_key: str, chash: str) -> dict | None:
    """
    Return the cached row for this exact article revision, or None.

    A miss and a broken database look the same to the caller on purpose: both
    mean "no cached answer", and the caller's fallback is the same either way.
    Failures are logged rather than raised so a cache outage degrades the
    product to its pre-cache behaviour instead of breaking it.
    """
    if not is_configured() or not url_key or not chash:
        return None

    try:
        response = requests.get(
            _rest_url(ERRATA_TABLE),
            headers=_headers(),
            params={
                "select": "verdicts,checked_at,model",
                "url_key": f"eq.{url_key}",
                "content_hash": f"eq.{chash}",
                "limit": 1,
            },
            timeout=6,
        )
    except requests.RequestException as exc:
        print("ERRATA FETCH UNREACHABLE:", exc)
        return None

    if response.status_code != 200:
        print("ERRATA FETCH FAILED:", response.status_code, response.text[:200])
        return None

    rows = response.json()
    if not rows:
        return None

    row = rows[0]
    checked_at = _parse_ts(row.get("checked_at"))
    stale = (
        checked_at is None
        or datetime.now(timezone.utc) - checked_at > timedelta(days=ERRATA_TTL_DAYS)
    )
    return {
        "verdicts": row.get("verdicts") or [],
        "checked_at": row.get("checked_at"),
        "model": row.get("model"),
        "stale": stale,
    }


def store(url_key: str, chash: str, verdicts: list, model: str, title: str = "") -> None:
    """
    Upsert this article's verdicts. Only cacheable ones are written — see
    is_cacheable. Never raises: failing to cache is not a reason to fail the
    request the reader is waiting on.
    """
    if not is_configured() or not url_key or not chash:
        return

    keepers = [v for v in verdicts if is_cacheable(v)]

    try:
        response = requests.post(
            _rest_url(ERRATA_TABLE),
            headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            # PostgREST infers the conflict target from the PRIMARY KEY unless
            # told otherwise. Ours is the surrogate `id`, so without this it
            # treats every write as a fresh insert and the second reader of an
            # article gets a 23505 instead of a refreshed row.
            params={"on_conflict": "url_key,content_hash"},
            json={
                "url_key": url_key,
                "content_hash": chash,
                "title": (title or "")[:300],
                "verdicts": keepers,
                "model": model,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            },
            timeout=8,
        )
        if response.status_code >= 300:
            print("ERRATA STORE FAILED:", response.status_code, response.text[:200])
    except requests.RequestException as exc:
        print("ERRATA STORE UNREACHABLE:", exc)


def report(url_key: str, chash: str, claim: str, reason: str) -> bool:
    """
    Record that a reader thinks a cached verdict is wrong.

    Reports are the only correction channel a shared cache has — without one, a
    confidently wrong ruling sits on a popular page until its TTL expires. They
    are written to their own table so a bad report can never edit a verdict.
    """
    if not is_configured():
        return False
    try:
        response = requests.post(
            _rest_url("errata_reports"),
            headers=_headers({"Prefer": "return=minimal"}),
            json={
                "url_key": url_key,
                "content_hash": chash,
                "claim": (claim or "")[:600],
                "reason": (reason or "")[:600],
            },
            timeout=6,
        )
        return response.status_code < 300
    except requests.RequestException as exc:
        print("ERRATA REPORT UNREACHABLE:", exc)
        return False


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
