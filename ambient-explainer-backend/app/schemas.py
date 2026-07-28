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

class ErrataCheckRequest(BaseModel):
    url: str
    text: str                      # the article body, as the reader sees it
    title: Optional[str] = None
    force: Optional[bool] = False  # re-check even on a fresh cache hit

class ErrataResponse(BaseModel):
    hit: bool                      # served from cache rather than computed
    verdicts: List[dict] = []
    checked_at: Optional[str] = None
    content_hash: Optional[str] = None
    url_key: Optional[str] = None
    # Why there's nothing to show, when there's nothing to show. "miss" and
    # "unconfigured" look identical to a reader but mean opposite things to us.
    reason: Optional[str] = None

class ErrataReportRequest(BaseModel):
    url: str
    content_hash: str
    claim: str
    reason: Optional[str] = ""
