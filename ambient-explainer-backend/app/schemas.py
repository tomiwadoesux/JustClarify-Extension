from pydantic import BaseModel
from typing import List, Optional

class ExplainRequest(BaseModel):
    highlighted_text: str
    context_window: str
    mode: Optional[str] = "default"
    followup_question: Optional[str] = None
    force_ai: Optional[bool] = False  # skip dictionary fast-path

    # Optional hyper-context
    page_title: Optional[str] = None
    url: Optional[str] = None
    heading_path: Optional[List[str]] = None

class ExplanationResponse(BaseModel):
    explanation: str
    confidence: str  # "high" | "medium" | "low"
    ambiguity: bool
    suggested_questions: List[str]
    source: str = "ai"  # "dictionary" | "ai"

class CollapseBlock(BaseModel):
    id: int
    text: str

class CollapsePlanRequest(BaseModel):
    highlighted_text: str
    blocks: List[CollapseBlock]

class TransformRequest(BaseModel):
    text: str
    mode: str  # humanize | paraphrase | formal | casual | simplify | shorten | expand | grammar

class TransformResponse(BaseModel):
    text: str
    mode: str

class CaptureEmailRequest(BaseModel):
    email: str

class CaptureEmailResponse(BaseModel):
    success: bool
    provider: str = "resend"
