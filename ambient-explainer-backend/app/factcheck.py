"""
Server-side fact-checking — the write path behind the shared errata cache.

This mirrors the extension's factcheck.js deliberately, rule for rule, because
the two have to agree: a reader who triggers a live check and a reader served
the cached row must see the same verdict for the same sentence, or the cache
looks broken rather than fast.

The evidence rule is unchanged from the extension. A verdict is only worth
showing if it's grounded in something the reader can click, so nothing here ever
asks a model "is this true?" from memory:

  1. PUBLISHED FACT-CHECKS (free) — Google's ClaimReview index. A hit means a
     human fact-checker already ruled. Strongest answer available, costs nothing.
  2. SEARCH + MODEL (paid) — only when step 1 finds nothing. A search-native
     model so retrieval and reasoning happen in one call, keeping the citations.

What differs is who pays. Here the key is the server's, so the cost of a check
is bounded by the number of *articles*, not the number of readers.
"""

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor

import requests

GOOGLE_FACTCHECK_API_KEY = os.getenv("GOOGLE_FACTCHECK_API_KEY")
GOOGLE_FACTCHECK_URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

AI_GATEWAY_API_KEY = os.getenv("AI_GATEWAY_API_KEY", "")
AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions"

# Perplexity's sonar models search the web as part of ordinary generation and
# return a citations array, so a plain chat/completions POST yields a grounded
# answer with no tool-calling round trip.
SEARCH_MODEL = os.getenv("FACTCHECK_SEARCH_MODEL", "perplexity/sonar")
# Claim extraction is ordinary text work on text we already hold, so it runs on
# something cheap. In the extension this job goes to the on-device model; there
# is no on-device model on a server, so the cheapest hosted one stands in.
EXTRACT_MODEL = os.getenv("FACTCHECK_EXTRACT_MODEL", "openai/gpt-5.4-mini")

VERDICTS = ["TRUE", "MOSTLY_TRUE", "MIXED", "MOSTLY_FALSE", "FALSE", "UNVERIFIABLE"]

# How many claims one article is allowed to spend. The cap is what keeps a
# 6,000-word feature from costing sixty search calls.
MAX_CLAIMS = int(os.getenv("FACTCHECK_MAX_CLAIMS", "6"))

VERDICT_RULES = """
Rules:
- Judge ONLY objectively checkable assertions. Opinions, predictions, promises,
  value judgements and rhetorical questions are UNVERIFIABLE by definition.
- Use UNVERIFIABLE freely. It is the correct answer whenever the evidence you
  found does not actually settle the claim. Never guess to seem useful.
- Judge the claim as stated, not a stronger or weaker version of it.
- Every source URL you cite must be one you actually retrieved."""

EXTRACT_RULES = """Extract only sentences that state a checkable fact — a number, date, event, quantity, attribution or causal assertion that could in principle be shown false.
Skip opinions, predictions, promises, questions, definitions and generic statements."""


# ---------- 1. Published fact-checks (free) ----------

def lookup_published(claim: str, language: str = "en") -> dict:
    """
    Published rulings for a claim, straight from Google's ClaimReview index.

    Returns {"ok": bool, "results": [...]}. `ok=False` means the lookup could
    not run at all, which is NOT the same as running and finding nothing — most
    claims have simply never been formally fact-checked. Collapsing the two
    makes a broken lookup indistinguishable from an unruled claim, and the
    reader can't tell they're being told something false.
    """
    query = (claim or "").strip()[:300]
    if not query:
        return {"ok": True, "results": []}
    if not GOOGLE_FACTCHECK_API_KEY:
        return {"ok": True, "results": []}

    try:
        response = requests.get(
            GOOGLE_FACTCHECK_URL,
            params={
                "query": query,
                "languageCode": language,
                "pageSize": 5,
                "key": GOOGLE_FACTCHECK_API_KEY,
            },
            timeout=8,
        )
    except requests.RequestException:
        return {"ok": False, "results": []}

    if response.status_code != 200:
        print("FACTCHECK LOOKUP FAILURE:", response.status_code, response.text[:200])
        return {"ok": False, "results": []}

    claims = response.json().get("claims", [])
    results = []
    for item in claims:
        for review in item.get("claimReview", []) or []:
            results.append({
                "claim": item.get("text") or query,
                "claimant": item.get("claimant") or "",
                "publisher": (review.get("publisher") or {}).get("name") or "",
                "rating": review.get("textualRating") or "",
                "title": review.get("title") or "",
                "url": review.get("url") or "",
            })
    return {"ok": True, "results": results}


def rating_to_verdict(rating: str) -> str:
    """
    Map a publisher's own wording ("Pants on Fire", "Four Pinocchios",
    "Correct") onto our scale. Deliberately conservative: anything that can't be
    read confidently stays MIXED rather than being forced to a strong verdict.
    """
    r = (rating or "").lower()
    if re.search(r"pants on fire|pinocchio|fabricat|no evidence|baseless|debunk", r):
        return "FALSE"
    if re.search(r"^false|mostly false|incorrect|inaccurate|wrong|misleading", r):
        return "MOSTLY_FALSE" if re.search(r"mostly|partly", r) else "FALSE"
    if re.search(r"half|mixed|partly|partially|lacks context|missing context|exaggerat", r):
        return "MIXED"
    if re.search(r"mostly true|mostly accurate|largely", r):
        return "MOSTLY_TRUE"
    if re.search(r"^true|accurate|correct|confirmed|verified", r):
        return "TRUE"
    return "MIXED"


# ---------- Gateway ----------

def _gateway(model: str, prompt: str, max_tokens: int) -> dict | None:
    if not AI_GATEWAY_API_KEY:
        return None
    try:
        response = requests.post(
            AI_GATEWAY_URL,
            headers={
                "Authorization": f"Bearer {AI_GATEWAY_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0,
            },
            timeout=60,
        )
    except requests.RequestException as exc:
        print("GATEWAY UNREACHABLE:", exc)
        return None

    if response.status_code != 200:
        print("GATEWAY FAILURE:", response.status_code, response.text[:200])
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _content(data: dict | None) -> str:
    if not data:
        return ""
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""


# ---------- 2. Claim extraction ----------

def _extract_prompt(text: str, limit: int) -> str:
    # Two forms per claim, and both are load-bearing. `claim` stands alone so it
    # can be verified out of context; `quote` is the sentence exactly as printed
    # so the page can underline it in place. A paraphrased quote can't be found.
    return f"""{EXTRACT_RULES}
Rank by how much a reader would benefit from having it verified, and return at most {limit}.

For each, return an object with:
- "quote": the sentence copied EXACTLY from the text, character for character (same words, casing and punctuation) so it can be found again. Do not fix or shorten it.
- "claim": the same statement rewritten to stand on its own (resolve "he", "it", "last year" into the names and dates the passage makes clear).

TEXT:
\"\"\"{text[:9000]}\"\"\"

Reply with ONLY a JSON array of objects, no markdown fence:
[{{"quote":"...","claim":"..."}}]"""


def _parse_claims(raw: str, limit: int) -> list:
    match = re.search(r"\[[\s\S]*\]", raw or "")
    if not match:
        return []
    try:
        arr = json.loads(match.group())
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []

    claims = []
    for item in arr:
        if isinstance(item, str):
            text = item.strip()
            claim, quote = text, text
        elif isinstance(item, dict):
            claim = str(item.get("claim") or item.get("quote") or "").strip()
            quote = str(item.get("quote") or item.get("claim") or "").strip()
        else:
            continue
        if len(claim) > 12:
            claims.append({"claim": claim, "quote": quote})
    return claims[:limit]


def extract_claims(text: str, limit: int = MAX_CLAIMS) -> list:
    body = (text or "").strip()
    if len(body) < 40:
        return []
    raw = _content(_gateway(EXTRACT_MODEL, _extract_prompt(body, limit), 700))
    return _parse_claims(raw, limit)


# ---------- 3. Search-grounded verdict ----------

def _verdict_prompt(claim: str, context: str, published: list) -> str:
    priors = ""
    if published:
        lines = "\n".join(
            f'- {p["publisher"]} rated it "{p["rating"]}" — {p["url"]}' for p in published
        )
        priors = f"\nPublished fact-checks already found for this claim (weigh these heavily):\n{lines}\n"

    where = ""
    if context:
        where = (
            "\nIt appeared in this passage, so judge the meaning it carries there:\n"
            f'"""{context[:1200]}"""\n'
        )

    return f"""Fact-check this claim by searching for current evidence.

CLAIM: "{claim}"
{where}{priors}{VERDICT_RULES}

Reply with ONLY a JSON object, no markdown fence, in exactly this shape:
{{"verdict":"{'|'.join(VERDICTS)}","confidence":"high|medium|low","summary":"<=40 words, plain language, what the evidence shows","sources":[{{"title":"...","url":"..."}}]}}"""


def _parse_verdict(raw: str) -> dict | None:
    match = re.search(r"\{[\s\S]*\}", raw or "")
    if not match:
        return None
    try:
        parsed = json.loads(match.group())
    except json.JSONDecodeError:
        return None

    verdict = re.sub(r"[\s-]+", "_", str(parsed.get("verdict") or "").upper())
    sources = []
    if isinstance(parsed.get("sources"), list):
        for s in parsed["sources"][:6]:
            if isinstance(s, dict) and re.match(r"^https?://", str(s.get("url") or "")):
                sources.append({
                    "title": str(s.get("title") or s.get("url"))[:140],
                    "url": s["url"],
                })

    confidence = parsed.get("confidence")
    return {
        "verdict": verdict if verdict in VERDICTS else "UNVERIFIABLE",
        "confidence": confidence if confidence in ("high", "medium", "low") else "low",
        "summary": str(parsed.get("summary") or "").strip(),
        "sources": sources,
    }


def verify(claim: str, context: str, published: list) -> dict | None:
    data = _gateway(SEARCH_MODEL, _verdict_prompt(claim, context, published), 700)
    if data is None:
        return None
    parsed = _parse_verdict(_content(data))
    if not parsed:
        return None

    # Sonar returns the pages it actually read; those beat anything the model
    # typed into the JSON, so merge them in and de-duplicate by URL.
    cited = []
    for url in data.get("citations") or []:
        if isinstance(url, str) and re.match(r"^https?://", url):
            title = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
            cited.append({"title": title, "url": url})

    seen = set()
    merged = []
    for source in parsed["sources"] + cited:
        if source["url"] in seen:
            continue
        seen.add(source["url"])
        merged.append(source)
    parsed["sources"] = merged[:6]
    return parsed


# ---------- Orchestration ----------

def check_one(claim: str, context: str) -> dict | None:
    """One claim in, one verdict out. Published rulings win when they exist."""
    text = (claim or "").strip()
    if not text:
        return None

    lookup = lookup_published(text)
    published = lookup["results"]

    verified = verify(text, context, published)

    if verified is None:
        # The search leg couldn't run. A published ruling can still stand on its
        # own; otherwise say plainly that the check didn't complete rather than
        # inventing a ruling. Neither of these gets cached — see is_cacheable.
        if published:
            top = published[0]
            return {
                "claim": text,
                "verdict": rating_to_verdict(top["rating"]),
                "confidence": "high",
                "summary": f'{top["publisher"]} rated this "{top["rating"]}".',
                "sources": [
                    {"title": f'{p["publisher"]}{" — " + p["title"] if p["title"] else ""}',
                     "url": p["url"]}
                    for p in published[:4]
                ],
                "origin": "published",
            }
        return {
            "claim": text,
            "verdict": "UNVERIFIABLE",
            "confidence": "low",
            "summary": (
                "Couldn't complete the check — the search step was unavailable."
                if lookup["ok"]
                else "Couldn't reach the fact-check lookup."
            ),
            "sources": [],
            "origin": "error",
        }

    return {
        **verified,
        "claim": text,
        "sources": verified["sources"] or [
            {"title": p["publisher"], "url": p["url"]} for p in published[:3]
        ],
        "origin": "searched+published" if published else "searched",
    }


def check_text(text: str, limit: int = MAX_CLAIMS) -> dict:
    """
    Check a body of text end to end: pull the claims worth checking, then verify
    them concurrently. Each verdict carries the quote it came from so the page
    can tie the ruling back to the exact sentence it underlines.

    Threads rather than async because every leg of this is a blocking `requests`
    call, and claims are independent — six sequential search calls would put a
    minute on a cold article for no reason.
    """
    if not AI_GATEWAY_API_KEY:
        return {"ok": False, "reason": "no-gateway-key", "claims": [], "verdicts": []}

    claims = extract_claims(text, limit)
    if not claims:
        return {"ok": True, "claims": [], "verdicts": []}

    with ThreadPoolExecutor(max_workers=min(6, len(claims))) as pool:
        results = list(pool.map(lambda c: _safe_check(c, text), claims))

    verdicts = []
    for claim, result in zip(claims, results):
        if not result:
            continue
        result["quote"] = claim["quote"]
        verdicts.append(result)

    return {"ok": True, "claims": claims, "verdicts": verdicts}


def _safe_check(claim: dict, context: str) -> dict | None:
    try:
        return check_one(claim["claim"], context)
    except Exception as exc:  # one bad claim must not sink the article
        print("CLAIM CHECK FAILURE:", exc)
        return None
