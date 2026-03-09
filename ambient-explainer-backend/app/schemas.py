from pydantic import BaseModel
from typing import List, Optional

class ExplainRequest(BaseModel):
    highlighted_text: str
    context_window: str
    mode: Optional[str] = "default"
    followup_question: Optional[str] = None

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

class CaptureEmailRequest(BaseModel):
    email: str

class CaptureEmailResponse(BaseModel):
    success: bool
    provider: str = "resend"
