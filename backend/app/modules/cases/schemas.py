import uuid
from datetime import date, datetime
from typing import Annotated, Literal

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


Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
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


class ThreadSummaryOut(BaseModel):
    id: uuid.UUID
    case_code: str
    title: str
    status: str
    client_name: str | None
    severity: Severity
    due_date: date | None
    department_id: str
    secondary_department_ids: list[str]
    message_count: int
    last_message_at: datetime | None


class PrecedentOut(BaseModel):
    case_code: str
    title: str
    similarity_score: int
    how_past_case_went: str
    lead_name: str | None
    lead_is_alumni: bool


class ThreadViewOut(BaseModel):
    """Everything the case-thread screen renders, in one request."""

    id: uuid.UUID
    case_code: str
    title: str
    status: str
    client_name: str | None
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
    resolved_at: datetime | None
    precedents: list[PrecedentOut]
    participants: list[PersonOut]
    messages: list[ThreadMessageOut]


class ThreadMessageIn(BaseModel):
    id: uuid.UUID  # client-generated: retries are idempotent
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    is_milestone: bool = False


class CaseCreateIn(BaseModel):
    """Case intake: who it's for, what the problem is, how urgent, by when, who owns it."""

    id: uuid.UUID  # client-generated: a retried create returns the same case
    client_name: ClientName
    title: Title
    initial_request_brief: Brief  # the problem and its context
    severity: Severity = "MEDIUM"
    due_date: date | None = None
    lead_user_id: uuid.UUID | None = None  # the owner; defaults to the creator
    context_tags: ContextTags = {}
    department_id: str
    secondary_department_ids: list[str] = []


class CaseUpdateIn(BaseModel):
    """Partial edit of an open case's details. Only the fields sent are changed (explicit state: safe to retry)."""

    client_name: ClientName | None = None
    title: Title | None = None
    initial_request_brief: Brief | None = None
    severity: Severity | None = None
    due_date: date | None = None
    lead_user_id: uuid.UUID | None = None
    context_tags: ContextTags | None = None
    secondary_department_ids: list[str] | None = None
