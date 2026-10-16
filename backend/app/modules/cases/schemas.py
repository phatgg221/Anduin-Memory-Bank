import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, computed_field

from app.core.text import CASE_TAG


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    avatar_initials: str
    job_title: str | None
    primary_department_id: str | None
    is_active: bool
    departed_at: date | None


class CaseMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: PersonOut
    role: Literal["LEAD", "MEMBER"]
    joined_at: datetime


Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
SourceType = Literal["CLIENT_EMAIL", "CS_ESCALATION", "LEGAL_REDLINE", "SECURITY_RFP"]
FundName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
MAX_TAGS = 8


def _clean_tags(tags: dict[str, str]) -> dict[str, str]:
    cleaned = {k.strip()[:40]: v.strip()[:80] for k, v in tags.items() if k.strip() and v.strip()}
    if len(cleaned) > MAX_TAGS:
        raise ValueError(f"At most {MAX_TAGS} context tags")
    return cleaned


ContextTags = Annotated[dict[str, str], AfterValidator(_clean_tags)]
ClientName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
Brief = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=4000)]


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_name: str
    file_type: str


class ThreadMessageOut(BaseModel):
    """Same shape as a war-room message, so the UI renders both with one component."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seq: int
    case_id: uuid.UUID
    author: PersonOut | None
    content: str
    attached_artifact: AttachmentOut | None
    is_milestone: bool = Field(validation_alias="is_resolution_milestone")
    is_agent: bool = False
    mentioned_user_ids: list[uuid.UUID] = []
    created_at: datetime

    @computed_field
    @property
    def tagged_case_codes(self) -> list[str]:
        return list(dict.fromkeys(CASE_TAG.findall(self.content)))


class ArtifactRefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_name: str
    file_type: str
    is_reusable: bool
    description: str
    text_status: str = "READY"
    text_method: str | None = None
    risk_flags: list[dict[str, str]] = []


class ThreadSummaryOut(BaseModel):
    id: uuid.UUID
    case_code: str
    title: str
    status: str
    client_name: str | None
    fund_name: str | None
    source_type: SourceType | None
    severity: Severity
    due_date: date | None
    department_id: str
    secondary_department_ids: list[str]
    top_match_code: str | None
    top_match_score: int | None
    message_count: int
    last_message_at: datetime | None


class PrecedentFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_name: str
    file_type: str
    is_reusable: bool
    description: str
    uploaded_by: PersonOut | None


class DeltaItemOut(BaseModel):
    category: str
    past_approach: str
    current_requirement: str
    status: Literal["REUSABLE", "MODIFIED", "NET_NEW"]
    action_recommendation: str
    source_artifact: str | None
    source_artifact_id: uuid.UUID | None


class PrecedentOut(BaseModel):
    """One matched past case, with everything the delta tab and the reusable kit render."""

    case_id: uuid.UUID | None
    case_code: str
    title: str
    client_name: str | None
    department_id: str | None
    secondary_department_ids: list[str]
    similarity_score: int
    score_breakdown: dict[str, float] | None
    how_past_case_went: str
    pitfall_warnings: list[str]
    summary: str | None
    how_it_went: str | None
    duration_days: int | None
    resolved_at: datetime | None
    lead: PersonOut | None
    lead_name: str | None
    lead_is_alumni: bool
    delta_items: list[DeltaItemOut]
    artifacts: list[PrecedentFileOut]


class ThreadViewOut(BaseModel):
    """Everything the case-thread screen renders, in one request."""

    id: uuid.UUID
    case_code: str
    channel_slug: str
    title: str
    status: str
    client_name: str | None
    fund_name: str | None
    source_type: SourceType | None
    severity: Severity
    due_date: date | None
    department_id: str
    secondary_department_ids: list[str]
    initial_request_brief: str
    context_tags: dict[str, str]
    created_by: PersonOut | None
    lead: PersonOut | None
    created_at: datetime
    artifacts: list[ArtifactRefOut]
    summary: str | None
    outcome: str | None = None
    final_output: str | None = None
    resolved_at: datetime | None
    precedents: list[PrecedentOut]
    triage_report: dict[str, Any] | None = None
    participants: list[PersonOut]
    members: list[CaseMemberOut]
    messages: list[ThreadMessageOut]


class ThreadMessageIn(BaseModel):
    id: uuid.UUID  # client-generated: retries are idempotent
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    is_milestone: bool = False
    # Any case's file: lets the team pull a precedent's deliverable into this thread ("Use in case").
    attached_artifact_id: uuid.UUID | None = None
    mentioned_user_ids: Annotated[list[uuid.UUID], Field(max_length=20)] = []  # @mentions; they join the case


class CaseCreateIn(BaseModel):
    """Case intake: who it's for, what the problem is, how urgent, by when, who owns it."""

    id: uuid.UUID  # client-generated: a retried create returns the same case
    client_name: ClientName
    fund_name: FundName | None = None  # the parent project / fund
    source_type: SourceType | None = None  # how the request arrived
    title: Title
    initial_request_brief: Brief  # the problem and its context
    severity: Severity = "MEDIUM"
    due_date: date | None = None
    lead_user_id: uuid.UUID | None = None  # the owner; defaults to the creator
    context_tags: ContextTags = {}
    department_id: str
    secondary_department_ids: list[str] = []
    member_ids: Annotated[list[uuid.UUID], Field(max_length=20)] = []  # colleagues engaged to resolve it


class CaseUpdateIn(BaseModel):
    """Partial edit of an open case's details. Only the fields sent are changed (explicit state: safe to retry)."""

    client_name: ClientName | None = None
    fund_name: FundName | None = None
    source_type: SourceType | None = None
    title: Title | None = None
    initial_request_brief: Brief | None = None
    severity: Severity | None = None
    due_date: date | None = None
    lead_user_id: uuid.UUID | None = None
    context_tags: ContextTags | None = None
    secondary_department_ids: list[str] | None = None
