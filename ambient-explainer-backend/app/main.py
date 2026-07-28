import os
import json
import re
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from app import errata as errata_store
from app import factcheck as factcheck_engine
from app.email_validation import normalize_email, validate_signup_email
from app.schemas import (
    CaptureEmailRequest,
    CaptureEmailResponse,
    CollapsePlanRequest,
    ErrataCheckRequest,
    ErrataReportRequest,
    ErrataResponse,
    ExplainRequest,
    ExplanationResponse,
    TransformRequest,
    TransformResponse,
)
from app.utils import is_single_word, lookup_dictionary, normalize_text

load_dotenv()

HF_API_TOKEN = os.getenv("HF_API_TOKEN")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
# Small + fast model by default. Override with HF_MODEL env var for higher
# quality (e.g. "meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct").
HF_MODEL = os.getenv("HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct")

HF_URL = "https://router.huggingface.co/v1/chat/completions"

# Google's Fact Check Tools API indexes ClaimReview markup published by
# PolitiFact, Snopes, FactCheck.org, AFP and hundreds of other outlets. It's
# free, but it needs a key — so the extension proxies through here rather than
# shipping a key inside a public, open-source bundle where it would be
# extracted and its quota burned. Self-hosters can set their own; users who
# prefer no server can put a personal key in the extension instead.
GOOGLE_FACTCHECK_API_KEY = os.getenv("GOOGLE_FACTCHECK_API_KEY")
GOOGLE_FACTCHECK_URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search"
RESEND_AUDIENCE_ID = os.getenv("RESEND_AUDIENCE_ID")
RESEND_CONTACTS_URL = "https://api.resend.com/audiences/{audience_id}/contacts"

# Marker used to split streaming output into explanation + suggested questions.
QUESTIONS_MARKER = "---QUESTIONS---"

app = FastAPI(
    title="JustClarify API",
    version="0.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_json(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON object found")
    return json.loads(match.group())


# ---------- Prompt building ----------

def _mode_instruction(mode: str) -> str:
    return {
        "simpler":  "Explain this in ONE short, friendly sentence using everyday words. Be concrete and vivid — not vague.",
        "detailed": "Explain this thoroughly in 4-6 sentences. Unpack the meaning, any nuance, why it matters here, and how it connects to the surrounding idea.",
        "example":  "Explain this with a clear, vivid real-world example or analogy in 2-4 sentences. Start with the example, then one line tying it back.",
    }.get(mode, "Explain the meaning in 2-4 clear sentences. Be specific and useful — not a one-line gloss.")


def build_explain_prompt_json(payload: ExplainRequest) -> str:
    """Prompt used for non-streaming /explain. Returns strict JSON."""
    task = (
        f"Answer this follow-up question: {payload.followup_question}"
        if payload.mode == "followup" and payload.followup_question
        else _mode_instruction(payload.mode)
    )

    return f"""You are JustClarify, an ambient reading assistant that helps people understand what they're reading without leaving the page.

HOW TO EXPLAIN:
- Use the surrounding CONTEXT to understand how the highlighted text is being used *here*.
- You MAY draw on general knowledge when it helps the reader understand better — grounded in how the word/phrase is used in this context.
- Do NOT hallucinate facts specific to the passage that aren't in the context.
- Be calm, specific, and genuinely useful. Avoid generic dictionary-gloss answers.
- If the highlighted text is ambiguous, pick the sense that fits the context and explain that sense.

CONTEXT:
{payload.context_window}

HIGHLIGHTED TEXT:
{payload.highlighted_text}

TASK:
{task}

SUGGESTED QUESTIONS must:
- Be short (max 10 words)
- Be specific to the highlighted text
- Lead to deeper understanding (not trivia)
- Not repeat the explanation

Return ONLY valid JSON in this exact format:
{{
  "explanation": "string",
  "confidence": "high | medium | low",
  "ambiguity": true | false,
  "suggested_questions": ["string", "string", "string"]
}}
"""


def build_explain_prompt_stream(payload: ExplainRequest) -> str:
    """Prompt used for streaming — plain-text output separated by a marker."""
    task = (
        f"Answer this follow-up question: {payload.followup_question}"
        if payload.mode == "followup" and payload.followup_question
        else _mode_instruction(payload.mode)
    )

    return f"""You are JustClarify, an ambient reading assistant that helps people understand what they're reading without leaving the page.

HOW TO EXPLAIN:
- Use the surrounding CONTEXT to understand how the highlighted text is being used here.
- You MAY draw on general knowledge when it helps the reader — grounded in how the text is used in this context.
- Do NOT invent facts specific to the passage that aren't in the context.
- Be calm, specific, and genuinely useful. Avoid generic dictionary-gloss answers.
- If the highlighted text is ambiguous, pick the sense that fits the context and explain that sense.

CONTEXT:
{payload.context_window}

HIGHLIGHTED TEXT:
{payload.highlighted_text}

TASK:
{task}

OUTPUT FORMAT (exactly this — no preamble, no markdown headers):
<your explanation text here>
{QUESTIONS_MARKER}
<short question 1>
<short question 2>
<short question 3>

Each suggested question: <= 10 words, specific to the highlighted text, leading to deeper understanding."""


# ---------- HF (non-streaming) ----------

def call_huggingface(prompt: str, max_tokens: int = 500) -> str:
    response = requests.post(
        HF_URL,
        headers={
            "Authorization": f"Bearer {HF_API_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "model": HF_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.4,
        },
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(response.text)

    data = response.json()
    if "choices" in data and len(data["choices"]) > 0:
        return data["choices"][0]["message"]["content"]

    raise RuntimeError(f"Unexpected HF response: {data}")


# ---------- HF (streaming) ----------

def stream_huggingface_chunks(prompt: str):
    """Yields content deltas (str) from the HF OpenAI-compatible stream."""
    with requests.post(
        HF_URL,
        headers={
            "Authorization": f"Bearer {HF_API_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json={
            "model": HF_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 500,
            "temperature": 0.4,
            "stream": True,
        },
        stream=True,
        timeout=45,
    ) as r:
        if r.status_code != 200:
            raise RuntimeError(f"HF stream {r.status_code}: {r.text[:200]}")

        for raw_line in r.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            # OpenAI SSE lines: "data: {...}" or "data: [DONE]"
            if raw_line.startswith("data:"):
                payload = raw_line[5:].strip()
                if payload == "[DONE]":
                    return
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                try:
                    delta = obj["choices"][0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield content
                except (KeyError, IndexError):
                    continue


# ---------- Resend (email capture) ----------

def create_resend_contact(email: str) -> None:
    if not RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="RESEND_API_KEY is not configured.")
    if not RESEND_AUDIENCE_ID:
        raise HTTPException(status_code=500, detail="RESEND_AUDIENCE_ID is not configured.")

    url = RESEND_CONTACTS_URL.format(audience_id=RESEND_AUDIENCE_ID)

    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={"email": email, "unsubscribed": False},
        timeout=10,
    )

    if response.status_code in {200, 201}:
        return

    try:
        error_payload = response.json()
    except ValueError:
        error_payload = {"message": response.text}

    error_text = json.dumps(error_payload).lower()
    if response.status_code == 409 or "already exists" in error_text:
        return

    raise HTTPException(status_code=502, detail="Could not save email to Resend.")


# ---------- Routes ----------

@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/factcheck/lookup")
def factcheck_lookup(query: str, language: str = "en"):
    """
    Published fact-checks for a claim, straight from Google's ClaimReview index.

    Returns Google's own payload shape ({"claims": [...]}) so the extension can
    read it identically whether it came through here or from a user's personal
    key. An empty result is a normal answer, not an error — most claims have
    never been formally fact-checked.
    """
    query = (query or "").strip()[:300]
    if not query:
        return {"claims": []}

    if not GOOGLE_FACTCHECK_API_KEY:
        # Deployment simply hasn't set a key. The extension treats an empty
        # result as "nothing published", which degrades to the AI search path.
        return {"claims": []}

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
        return {"claims": []}

    if response.status_code != 200:
        print("FACTCHECK LOOKUP FAILURE:", response.status_code, response.text[:200])
        return {"claims": []}

    return {"claims": response.json().get("claims", [])}


# ---------- Shared errata cache ----------
#
# The read path is free, keyless and fast; the write path is the only thing that
# costs money, and it runs here rather than in the extension so a verdict is
# computed once per article instead of once per reader.


@app.get("/errata", response_model=ErrataResponse)
def errata_read(url: str, content_hash: str):
    """
    Cached verdicts for an exact article revision. Never computes anything —
    this is the path every reader hits on every page, so it has to stay cheap
    enough to call speculatively.
    """
    if not errata_store.is_configured():
        return ErrataResponse(hit=False, reason="unconfigured")

    url_key = errata_store.normalize_url(url)
    if not url_key or not content_hash:
        return ErrataResponse(hit=False, reason="bad-request")

    row = errata_store.fetch(url_key, content_hash)
    if not row or row["stale"]:
        # A stale row is deliberately not served. An out-of-date ruling reads as
        # current to the reader, which is worse than showing nothing.
        return ErrataResponse(
            hit=False,
            reason="stale" if row else "miss",
            url_key=url_key,
            content_hash=content_hash,
        )

    return ErrataResponse(
        hit=True,
        verdicts=row["verdicts"],
        checked_at=row["checked_at"],
        url_key=url_key,
        content_hash=content_hash,
    )


@app.post("/errata/check", response_model=ErrataResponse)
def errata_check(payload: ErrataCheckRequest):
    """
    Read-through: serve the cache when it's warm, otherwise run the full
    pipeline on the server's key and store the result for everyone after.

    Two readers arriving on a cold popular article can both start a check. The
    upsert makes that harmless — same key, last write wins with identical
    content — so it costs a duplicated call, not a corrupted row. Worth
    revisiting with an advisory lock only if it shows up in the bill.
    """
    url_key = errata_store.normalize_url(payload.url)
    text = (payload.text or "").strip()
    if not url_key or len(text) < 40:
        return ErrataResponse(hit=False, reason="bad-request", url_key=url_key or None)

    chash = errata_store.content_hash(text)

    if not payload.force:
        row = errata_store.fetch(url_key, chash)
        if row and not row["stale"]:
            return ErrataResponse(
                hit=True,
                verdicts=row["verdicts"],
                checked_at=row["checked_at"],
                url_key=url_key,
                content_hash=chash,
            )

    result = factcheck_engine.check_text(text)
    if not result["ok"]:
        return ErrataResponse(
            hit=False, reason=result.get("reason") or "check-failed",
            url_key=url_key, content_hash=chash,
        )

    errata_store.store(
        url_key,
        chash,
        result["verdicts"],
        model=factcheck_engine.SEARCH_MODEL,
        title=payload.title or "",
    )

    # Return everything we found, including the verdicts too weak to cache —
    # the reader who paid the wait should see the full picture even though the
    # next reader won't inherit the shaky parts.
    return ErrataResponse(
        hit=False, verdicts=result["verdicts"], url_key=url_key, content_hash=chash,
    )


@app.post("/errata/report")
def errata_report(payload: ErrataReportRequest):
    """
    Flag a cached verdict as wrong. A shared cache with no correction channel
    leaves a confident mistake on a popular page until its TTL runs out.
    """
    url_key = errata_store.normalize_url(payload.url)
    if not url_key or not payload.content_hash:
        raise HTTPException(status_code=400, detail="url and content_hash are required.")

    ok = errata_store.report(url_key, payload.content_hash, payload.claim, payload.reason or "")
    return {"success": ok}


@app.post("/capture-email", response_model=CaptureEmailResponse)
def capture_email(payload: CaptureEmailRequest):
    email = normalize_email(payload.email)
    validation_error = validate_signup_email(email)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    create_resend_contact(email)
    return CaptureEmailResponse(success=True)


def _should_use_dictionary(payload: ExplainRequest) -> bool:
    """
    Dictionary fast-path is only worth taking when:
    - Mode is 'default' (not simpler/detailed/example/followup)
    - User hasn't asked for AI explicitly (force_ai)
    - Highlighted text is a single word
    - Context is thin / basically the word alone (otherwise we lose context-aware meaning)
    """
    if payload.mode != "default" or payload.force_ai:
        return False
    if not is_single_word(payload.highlighted_text.strip()):
        return False

    context = (payload.context_window or "").strip()
    # If context barely adds anything, dictionary is fine. Otherwise prefer AI.
    return len(context) < 60


def _dictionary_response(payload: ExplainRequest):
    word = normalize_text(payload.highlighted_text.strip())
    definition_result = lookup_dictionary(word)
    if not definition_result:
        return None

    final_explanation = (
        definition_result if "\n" in definition_result
        else f"“{word}” means {definition_result}"
    )

    return ExplanationResponse(
        explanation=final_explanation,
        confidence="high",
        ambiguity=False,
        suggested_questions=[
            "How is it used in context?",
            "Does it have another meaning?",
            "How is it used technically?",
        ],
        source="dictionary",
    )


@app.post("/explain", response_model=ExplanationResponse)
def explain_text(payload: ExplainRequest):
    # 1. Dictionary fast-path (narrowly — only when context is thin)
    if _should_use_dictionary(payload):
        dict_resp = _dictionary_response(payload)
        if dict_resp:
            return dict_resp

    # 2. LLM path
    try:
        raw = call_huggingface(build_explain_prompt_json(payload))
        parsed = extract_json(raw)
        return ExplanationResponse(**parsed, source="ai")
    except Exception as e:
        print("LLM FAILURE:", e)

    # 3. Fallback
    return ExplanationResponse(
        explanation="I couldn’t confidently explain this based on the available text.",
        confidence="low",
        ambiguity=True,
        suggested_questions=[
            "Can you expand the surrounding context?",
            "Can you rephrase the sentence?",
            "Which part is unclear?",
        ],
        source="ai",
    )


# ---------- Text transforms (rewrite box) ----------

# Instructions for each rewrite button in the extension's text-tools box.
TRANSFORM_MODES = {
    "humanize": (
        "Rewrite the text so it reads like a thoughtful person wrote it, not an AI. "
        "Vary sentence length, drop robotic transitions (\"moreover\", \"in conclusion\", "
        "\"it is important to note\"), cut filler and hedging, and use natural, direct phrasing. "
        "Keep the meaning, facts and rough length the same."
    ),
    "paraphrase": (
        "Rewrite the text in different words and sentence structures while keeping the exact "
        "meaning and roughly the same length. Do not add or remove information."
    ),
    "formal": (
        "Rewrite the text in a formal, professional tone suitable for business or academic "
        "writing. No slang or contractions. Keep the meaning and roughly the same length."
    ),
    "casual": (
        "Rewrite the text in a relaxed, conversational tone, like talking to a friend. "
        "Contractions are fine. Keep the meaning and roughly the same length."
    ),
    "simplify": (
        "Rewrite the text in plain, everyday words so it is easy to understand. Short sentences, "
        "no jargon. Keep all the key information."
    ),
    "shorten": (
        "Rewrite the text to be significantly shorter — cut redundancy and filler, keep every "
        "essential point. Aim for half the length or less."
    ),
    "expand": (
        "Rewrite the text to be longer and more developed — unpack the ideas, add clarifying "
        "detail and smooth transitions. Do not invent facts that contradict the original."
    ),
    "grammar": (
        "Correct all grammar, spelling and punctuation mistakes in the text. Change nothing "
        "else — keep the wording, tone and length as close to the original as possible."
    ),
}

MAX_TRANSFORM_CHARS = 6000


def build_transform_prompt(mode: str, text: str) -> str:
    return f"""You are a precise text rewriting tool.

TASK:
{TRANSFORM_MODES[mode]}

RULES:
- Reply with ONLY the rewritten text.
- No preamble (never say "Here is..."), no quotes around it, no explanations, no markdown.
- Keep the same language as the input.
- Preserve paragraph breaks.

TEXT:
{text}"""


@app.post("/transform", response_model=TransformResponse)
def transform_text(payload: TransformRequest):
    mode = (payload.mode or "").strip().lower()
    if mode not in TRANSFORM_MODES:
        raise HTTPException(status_code=400, detail=f"Unknown mode '{payload.mode}'.")

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty.")
    text = text[:MAX_TRANSFORM_CHARS]

    try:
        raw = call_huggingface(build_transform_prompt(mode, text), max_tokens=1500)
    except Exception as e:
        print("TRANSFORM FAILURE:", e)
        raise HTTPException(status_code=502, detail="Rewrite failed — try again.")

    result = raw.strip()
    # Models sometimes wrap the whole reply in quotes despite the rules.
    if len(result) > 1 and result[0] == result[-1] and result[0] in "\"'“”":
        result = result[1:-1].strip()

    return TransformResponse(text=result, mode=mode)


# ---------- Collapse planning (space optimizer) ----------

def build_collapse_prompt(payload: CollapsePlanRequest) -> str:
    blocks_text = "\n".join(f"[{b.id}] {b.text}" for b in payload.blocks)
    return f"""You are JustClarify's space optimizer. The user highlighted a key passage and wants the SURROUNDING context blocks folded away to save space, while keeping the highlight in focus and still understandable.

HIGHLIGHTED (keep in focus — never fold this):
{payload.highlighted_text}

SURROUNDING BLOCKS (each has an id):
{blocks_text}

Decide which surrounding blocks are supporting/contextual detail that can be folded to save space WITHOUT making the highlighted passage confusing, vs which are essential to keep visible. Be willing to fold — the goal is to reduce clutter. For each block you fold, write a 3-6 word gist of what it contains.

Return ONLY valid JSON in this exact shape:
{{"fold": [{{"id": <int>, "gist": "<3-6 words>"}}], "keep": [<int>, ...]}}"""


@app.post("/collapse-plan")
def collapse_plan(payload: CollapsePlanRequest):
    """HF reads the blocks around a highlight and decides which to fold + a gist."""
    if not payload.blocks:
        return {"fold": [], "keep": []}

    valid_ids = {b.id for b in payload.blocks}
    try:
        raw = call_huggingface(build_collapse_prompt(payload))
        parsed = extract_json(raw)
        fold_in = parsed.get("fold", []) if isinstance(parsed, dict) else []

        fold = []
        for f in fold_in:
            try:
                fid = int(f["id"])
            except (KeyError, TypeError, ValueError):
                continue
            if fid in valid_ids:
                fold.append({"id": fid, "gist": str(f.get("gist", "")).strip()[:80]})

        folded_ids = {f["id"] for f in fold}
        keep = [i for i in valid_ids if i not in folded_ids]
        return {"fold": fold, "keep": keep}
    except Exception as e:
        print("COLLAPSE PLAN FAILURE:", e)
        # Safe fallback: fold nothing.
        return {"fold": [], "keep": list(valid_ids)}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/explain-stream")
def explain_stream(payload: ExplainRequest):
    """
    Streams the explanation as tokens via SSE.

    Events:
      event: token   data: {"text": "..."}     (zero or more)
      event: done    data: {full ExplanationResponse}
      event: error   data: "<msg>"
    """

    def stream():
        # Dictionary fast-path — emit the whole thing in one go.
        if _should_use_dictionary(payload):
            dict_resp = _dictionary_response(payload)
            if dict_resp:
                yield _sse("token", {"text": dict_resp.explanation})
                yield _sse("done", dict_resp.model_dump())
                return

        prompt = build_explain_prompt_stream(payload)
        buffer = ""             # everything received so far
        emitted_len = 0         # how many chars of buffer already sent as tokens
        reached_marker = False
        marker_len = len(QUESTIONS_MARKER)

        try:
            for chunk in stream_huggingface_chunks(prompt):
                buffer += chunk

                if not reached_marker:
                    idx = buffer.find(QUESTIONS_MARKER)
                    if idx == -1:
                        # Safe to emit up to (len - marker_len) chars to avoid
                        # sending a marker prefix that becomes the real marker.
                        safe_end = max(0, len(buffer) - marker_len)
                        if safe_end > emitted_len:
                            to_send = buffer[emitted_len:safe_end]
                            # Skip leading whitespace on the very first token.
                            if emitted_len == 0:
                                to_send = to_send.lstrip()
                            if to_send:
                                yield _sse("token", {"text": to_send})
                            emitted_len = safe_end
                    else:
                        # Emit everything before marker, then stop emitting.
                        tail = buffer[emitted_len:idx].rstrip()
                        if emitted_len == 0:
                            tail = tail.lstrip()
                        if tail:
                            yield _sse("token", {"text": tail})
                        emitted_len = idx + marker_len
                        reached_marker = True

            # After stream closes:
            if not reached_marker:
                # Flush any held-back text (no marker appeared).
                tail = buffer[emitted_len:].rstrip()
                if emitted_len == 0:
                    tail = tail.lstrip()
                if tail:
                    yield _sse("token", {"text": tail})

            # Parse final payload.
            marker_pos = buffer.find(QUESTIONS_MARKER)
            if marker_pos != -1:
                explanation = buffer[:marker_pos].strip()
                tail = buffer[marker_pos + marker_len:].strip()
                questions = [
                    re.sub(r"^[\-\*\d\.\)\s]+", "", line).strip()
                    for line in tail.splitlines()
                    if line.strip()
                ][:3]
            else:
                explanation = buffer.strip()
                questions = []

            done_payload = {
                "explanation": explanation or "",
                "confidence": "medium",
                "ambiguity": False,
                "suggested_questions": questions,
                "source": "ai",
            }
            yield _sse("done", done_payload)

        except Exception as e:
            print("STREAM FAILURE:", e)
            yield _sse(
                "error",
                {"message": "stream failed"}
                if not isinstance(e, RuntimeError) else {"message": str(e)[:200]},
            )

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)
