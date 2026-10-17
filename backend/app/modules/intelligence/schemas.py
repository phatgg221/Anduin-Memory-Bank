"""LLM contracts. The model fills these; code validates them and sets every ID afterwards (guard.py)."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class PitfallDraft(BaseModel):
    warning: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=600)] = Field(
        description="A concrete warning for the next team: what broke or nearly broke, the impact, and how to avoid it."
    )
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    reference: str | None = Field(
        default=None,
        description='Where this comes from: "Chat #L<n>" (a line number in the transcript) or an attachment file name.',
    )


class CaseMemoryDraft(BaseModel):
    """What the summarizer writes from a case thread, for a human to review before it's committed."""

    summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=1200)] = Field(
        description="2-3 sentences: the problem and the fix, specific enough to match a future request."
    )
    how_it_went: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=3000)] = Field(
        description="4-8 sentences: what happened, impact (delays, people, money), blockers, and how it was resolved."
    )
    resolution_steps: list[Text] = Field(min_length=1, max_length=8, description="Imperative steps that fixed it.")
    pitfalls: list[PitfallDraft] = Field(default_factory=list, max_length=6)
    context_tags: dict[str, str] = Field(
        default_factory=dict,
        description='Up to 6 Title Case labels for retrieval, e.g. {"Jurisdiction": "Cayman Islands"}.',
    )


class GuardedPitfall(BaseModel):
    warning: str
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    reference: str | None
    authorId: str | None  # noqa: N815 — matches the stored JSONB shape (camelCase, like the seed pack)
    messageId: str | None  # noqa: N815


class CaseMemoryRecord(BaseModel):
    """A guarded draft: references checked, author/message IDs set by code from the referenced transcript line."""

    summary: str
    how_it_went: str
    resolution_steps: list[str]
    pitfalls: list[GuardedPitfall]
    context_tags: dict[str, str]


@dataclass
class TranscriptMessage:
    id: uuid.UUID
    author_id: uuid.UUID | None
    author_name: str
    author_title: str | None
    author_active: bool
    content: str
    created_at: datetime
    is_milestone: bool
    attachment: str | None = None


@dataclass
class ThreadContext:
    """Everything the summarizer may read: plain data, assembled by the triage worker."""

    case_code: str
    title: str
    department: str
    initial_request_brief: str
    context_tags: dict[str, str]
    messages: list[TranscriptMessage]
    client_name: str | None = None
    severity: str = "MEDIUM"
    due_date: str | None = None
    artifacts: list[str] = field(default_factory=list)
    room_mentions: list[TranscriptMessage] = field(default_factory=list)
    outcome: str | None = None  # from the team at commit time: how it ended
    final_output: str | None = None  # what was delivered to the client
    deliverables: list[str] = field(default_factory=list)  # file names the team marked as the final output
    # Deliverable name → (file type, extracted text): e.g. the client's approval email or sign-off PDF.
    deliverable_texts: dict[str, tuple[str, str]] = field(default_factory=dict)
    approvals: list[str] = field(default_factory=list)  # client sign-offs: evidence, not reusable knowledge


# --- ANALYZE: incoming request vs. top-3 precedents ------------------------------------------------------------


class DeltaItemDraft(BaseModel):
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)] = Field(
        description="The operational dimension, e.g. 'W-8BEN-E joint-signer routing'."
    )
    past_approach: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1200)]
    current_requirement: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1200)]
    status: Literal["REUSABLE", "MODIFIED", "NET_NEW"]
    action_recommendation: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1200)]
    source_artifact: str | None = Field(
        default=None,
        description="Exact file name from that precedent's <artifact> list, or null (always null for NET_NEW).",
    )


class PrecedentComparisonDraft(BaseModel):
    case_code: str = Field(description="One of the precedent case codes given in the context.")
    how_past_case_went: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2000)]
    pitfall_warnings: list[Annotated[str, StringConstraints(strip_whitespace=True, max_length=800)]] = Field(
        default_factory=list, max_length=6
    )
    delta_items: list[DeltaItemDraft] = Field(default_factory=list, max_length=8)


class CaseComparisonReport(BaseModel):
    comparisons: list[PrecedentComparisonDraft] = Field(min_length=1, max_length=3)


@dataclass
class PrecedentContext:
    """A retrieved past case, as the comparison sees it. Scores come from retrieval, never the model."""

    case_id: uuid.UUID
    case_code: str
    title: str
    client_name: str | None
    summary: str
    how_it_went: str
    resolution_steps: list[str]
    pitfalls: list[str]
    artifacts: dict[str, uuid.UUID]  # file name → id
    reusable_artifacts: list[str]
    similarity: int
    vector_similarity: float
    boost: int


@dataclass
class IncomingRequest:
    case_code: str
    title: str
    client_name: str | None
    fund_name: str | None
    source_type: str | None
    brief: str
    context_tags: dict[str, str]
    file_texts: dict[str, str] = field(default_factory=dict)

    def query_text(self) -> str:
        files = "\n".join(f"{name}: {text[:1500]}" for name, text in self.file_texts.items())
        tags = "; ".join(f"{k}: {v}" for k, v in self.context_tags.items())
        return f"{self.title}\n{self.client_name or ''} · {self.fund_name or ''}\n{tags}\n{self.brief}\n{files}"[:8000]


# --- COPILOT ---------------------------------------------------------------------------------------------------


class CopilotAnswerDraft(BaseModel):
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)] = Field(
        description="Plain text. Cite past cases inline as [CASE-YYYY-NNN] and files by exact file name."
    )
    cited_case_codes: list[str] = Field(default_factory=list, max_length=8)


# --- TRIAGE AGENT ------------------------------------------------------------------------------------------------

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]


class MissingInfoDraft(BaseModel):
    question: Text = Field(description="A question to send the client or counsel before work starts.")
    why: Text = Field(description="Why it matters, from what happened in a past case.")
    source_case_code: str | None = Field(default=None, description="The past case that taught us this, or null.")


class TeamPickDraft(BaseModel):
    user_id: str = Field(description="Exact user_id from a find_people result. Never invent one.")
    reason: Text = Field(description="What they did on which case, and why they help here.")


class DuplicateDraft(BaseModel):
    case_code: str = Field(description="Exact case_code from a check_active_duplicates result.")
    reason: Text


class TriageReportDraft(BaseModel):
    """The agent's synthesis after investigating. Numbers, scores and IDs are checked or replaced by code."""

    summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=1500)] = Field(
        description="Why the top precedent matches, what is different this time, and the recommended first move."
    )
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    risk_reasons: list[Text] = Field(default_factory=list, max_length=5)
    missing_info: list[MissingInfoDraft] = Field(default_factory=list, max_length=6)
    team: list[TeamPickDraft] = Field(default_factory=list, max_length=5)
    duplicates: list[DuplicateDraft] = Field(default_factory=list, max_length=3)


# --- MEMORY CURATOR ----------------------------------------------------------------------------------------------


class ReusableFileDraft(BaseModel):
    file_name: str = Field(description="Exact file name from <files>.")
    reason: Text = Field(description="What a future team would reuse it for.")


class ContradictionDraft(BaseModel):
    case_code: str = Field(description="Exact case_code from <older_memory>.")
    existing: Text = Field(description="What the older case's memory says.")
    new: Text = Field(description="What this case's record says instead.")
    explanation: Text = Field(description="Why they conflict, and which one a future team should trust (and why).")


class CuratorDraft(BaseModel):
    reusable_files: list[ReusableFileDraft] = Field(default_factory=list, max_length=8)
    contradictions: list[ContradictionDraft] = Field(default_factory=list, max_length=5)


# --- LONG THREADS: condensed segment notes -----------------------------------------------------------------------


class SegmentNote(BaseModel):
    kind: Literal["DECISION", "STEP", "WARNING", "FACT", "OUTCOME"]
    point: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    line: int | None = Field(default=None, description="The transcript line number (the n of L<n>) it comes from.")
    who: str | None = Field(default=None, description="Who said it, as written in the transcript header.")


class SegmentNotes(BaseModel):
    notes: list[SegmentNote] = Field(default_factory=list, max_length=30)


REVIEW_VERDICTS = ("SUPPORTED", "CONFLICTS", "NO_PRECEDENT", "MISSING")


def _clip(limit: int) -> BeforeValidator:
    """Over-long model output is cut to size instead of failing the whole review."""
    return BeforeValidator(lambda value: value[:limit] if isinstance(value, str | list) else value)


def _verdict(value):
    return value.strip().upper().replace(" ", "_").replace("-", "_") if isinstance(value, str) else value


ReviewText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2)]


class ReviewClaimDraft(BaseModel):
    text: Annotated[ReviewText, _clip(400)] = Field(
        description="One concrete step, decision or assertion the team proposed, in a single sentence."
    )
    messages: Annotated[list[int], _clip(6)] = Field(
        default_factory=list, description="The M numbers where it was said."
    )


class ReviewClaimsDraft(BaseModel):
    claims: Annotated[list[ReviewClaimDraft], _clip(6)] = Field(default_factory=list, description="At most 6.")


class ReviewFindingDraft(BaseModel):
    claim: Annotated[ReviewText, _clip(400)]
    verdict: Annotated[Literal["SUPPORTED", "CONFLICTS", "NO_PRECEDENT", "MISSING"], BeforeValidator(_verdict)] = Field(
        description="SUPPORTED: past work did the same and it worked. CONFLICTS: memory shows it failed, was rejected "
        "or is wrong. NO_PRECEDENT: nothing in the evidence covers it. MISSING: past cases needed something the "
        "discussion hasn't covered (the claim says what)."
    )
    comment: Annotated[ReviewText, _clip(900)] = Field(
        description="Why, specifically, and what to do about it, in at most 4 sentences. Cite past cases as "
        "[CASE-YYYY-NNN]."
    )
    evidence: Annotated[list[str], _clip(4)] = Field(
        default_factory=list, description='At most 4 evidence tags, e.g. ["E3", "E7"].'
    )
    messages: Annotated[list[int], _clip(6)] = Field(default_factory=list, description="M numbers it is about.")


class ReviewDraft(BaseModel):
    overall: Annotated[ReviewText, _clip(600)] = Field(
        description="Two sentences: is the proposed solution sound, and the single most important thing to change."
    )
    findings: Annotated[list[ReviewFindingDraft], _clip(8)] = Field(default_factory=list, description="At most 8.")
