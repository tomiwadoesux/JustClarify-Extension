import os
import json
import re
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.email_validation import normalize_email, validate_signup_email
from app.schemas import (
    CaptureEmailRequest,
    CaptureEmailResponse,
    ExplainRequest,
    ExplanationResponse,
)
from app.utils import is_single_word, lookup_dictionary, normalize_text

load_dotenv()

HF_API_TOKEN = os.getenv("HF_API_TOKEN")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
HF_MODEL = "Qwen/Qwen2.5-72B-Instruct"

HF_URL = "https://router.huggingface.co/v1/chat/completions"
RESEND_CONTACTS_URL = "https://api.resend.com/contacts"

HEADERS = {
    "Authorization": f"Bearer {HF_API_TOKEN}"
}

app = FastAPI(
    title="JustClarify API",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_json(text: str) -> dict:
    """
    Extracts the first valid JSON object found in a string.
    """
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON object found")

    return json.loads(match.group())

def violates_context(explanation: str, context: str) -> bool:
    explanation_words = set(explanation.lower().split())
    context_words = set(context.lower().split())

    # Ignore common explanation words
    stopwords = {
        "the", "is", "means", "refers", "to", "that", "this",
        "it", "in", "of", "and", "or", "as", "basically",
        "essentially", "because", "when", "what"
    }

    explanation_words -= stopwords
    context_words -= stopwords

    unknown_words = explanation_words - context_words

    # MUCH higher threshold
    return len(unknown_words) > 120

def build_explain_prompt(payload):
    mode_instruction = {
        "simpler": "Explain this in ONE short sentence using everyday words a child could understand. Be extremely brief.",
        "detailed": "Explain this thoroughly in 4-6 sentences, breaking it down step by step with nuance and depth.",
        "example": "Explain this by giving a clear, relatable real-world example or analogy."
    }.get(payload.mode, "Explain the meaning in 2-3 concise sentences. Be clear but not overly simple or detailed.")

    # Handle follow-up questions
    if payload.mode == "followup" and payload.followup_question:
        task = f"Answer this follow-up question: {payload.followup_question}"
    else:
        task = mode_instruction

    return f"""
You are an ambient reading assistant.

RULES:
- Use ONLY the context provided.
- Do NOT introduce external knowledge.
- Be calm and non-judgmental.

CONTEXT:
{payload.context_window}

HIGHLIGHTED TEXT:
{payload.highlighted_text}

TASK:
{task}

Suggested questions should:
- Be short (max 10 words)
- Be specific to the highlighted text
- Encourage deeper understanding, not trivia
- Avoid repeating the explanation

Return ONLY valid JSON in this format:
{{
  "explanation": "string",
  "confidence": "high | medium | low",
  "ambiguity": true | false,
  "suggested_questions": ["string", "string", "string"]
}}
"""

def build_explain_prompt_strict(payload):
    return f"""
You MUST follow these rules.

FAIL CONDITIONS:
- Do not introduce facts that are not implied by the context.
- You may rephrase or simplify the text.
- If you are unsure, mark ambiguity = true.
- Do NOT include any text outside JSON.

CONTEXT:
{payload.context_window}

HIGHLIGHTED TEXT:
{payload.highlighted_text}

TASK:
Return ONLY valid JSON in this exact format:

{{
  "explanation": "string",
  "confidence": "high | medium | low",
  "ambiguity": true | false,
  "suggested_questions": ["string", "string", "string"]
}}
"""

def call_huggingface(prompt: str) -> str:
    response = requests.post(
        HF_URL,
        headers={
            "Authorization": f"Bearer {HF_API_TOKEN}",
            "Content-Type": "application/json"
        },
        json={
            "model": HF_MODEL,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 300,
            "temperature": 0.3
        },
        timeout=30
    )

    if response.status_code != 200:
        raise RuntimeError(response.text)

    data = response.json()

    # OpenAI-compatible format
    if "choices" in data and len(data["choices"]) > 0:
        return data["choices"][0]["message"]["content"]

    raise RuntimeError(f"Unexpected HF response: {data}")

def create_resend_contact(email: str) -> None:
    if not RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="RESEND_API_KEY is not configured.")

    response = requests.post(
        RESEND_CONTACTS_URL,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "email": email,
            "unsubscribed": False,
            "properties": {
                "source": "justclarify_extension",
                "product": "justclarify",
            },
        },
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

    raise HTTPException(
        status_code=502,
        detail="Could not save email to Resend.",
    )

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/capture-email", response_model=CaptureEmailResponse)
def capture_email(payload: CaptureEmailRequest):
    email = normalize_email(payload.email)
    validation_error = validate_signup_email(email)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    create_resend_contact(email)
    return CaptureEmailResponse(success=True)

@app.post("/explain", response_model=ExplanationResponse)
def explain_text(payload: ExplainRequest):

    text = payload.highlighted_text.strip()

    # 1️⃣ Dictionary fast path (skip if user explicitly wants AI)
    if is_single_word(text) and payload.mode == "default":
        word = normalize_text(text)
        definition_result = lookup_dictionary(word)
        if definition_result:
            # If it's a numbered list matching "1.", just return it. 
            # Otherwise wrap it nicely if single line.
            if "\n" in definition_result:
                final_explanation = definition_result
            else:
                final_explanation = f"“{word}” means {definition_result}"

            return ExplanationResponse(
                explanation=final_explanation,
                confidence="high",
                ambiguity=False,
                suggested_questions=[
                    "Can you use it in a sentence?",
                    "Does it have another meaning?",
                    "Is this used differently in a technical context?"
                ],
                source="dictionary"
            )

    # 2️⃣ LLM path
    try:
        raw = call_huggingface(build_explain_prompt(payload))
        parsed = extract_json(raw)
        return ExplanationResponse(**parsed, source="ai")

    except Exception as e:
        print("LLM FAILURE:", e)
        # print("RAW OUTPUT:", raw if "raw" in locals() else "NONE")

    # 3️⃣ Fallback
    return ExplanationResponse(
        explanation="I couldn’t confidently explain this based on the available text.",
        confidence="low",
        ambiguity=True,
        suggested_questions=[
            "Can you expand the surrounding context?",
            "Can you rephrase the sentence?",
            "Which part is unclear?"
        ],
        source="ai"
    )
