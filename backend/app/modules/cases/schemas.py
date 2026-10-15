import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, computed_field

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


class ThreadSummaryOut(BaseModel):
    id: uuid.UUID
    case_code: str
    title: str
    status: str
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
    department_id: str
    secondary_department_ids: list[str]
    initial_request_brief: str
    context_tags: dict[str, str]
    created_by: PersonOut | None
    created_at: datetime
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
    id: uuid.UUID  # client-generated: a retried create returns the same case
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
    initial_request_brief: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=4000)]
    department_id: str
    secondary_department_ids: list[str] = []
