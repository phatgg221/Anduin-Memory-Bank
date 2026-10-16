import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.modules.cases.schemas import ThreadSummaryOut


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    avatar_initials: str
    job_title: str | None
    primary_department_id: str | None
    is_active: bool
    departed_at: date | None


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: PersonOut
    role: str
    joined_at: datetime


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_name: str
    file_type: str


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seq: int
    department_id: str
    author: PersonOut | None
    content: str
    tagged_case_codes: list[str]
    attached_artifact: AttachmentOut | None
    is_milestone: bool
    created_at: datetime


class RoomSummaryOut(BaseModel):
    department_id: str
    name: str
    code: str
    lead: PersonOut | None
    member_count: int
    unread_count: int
    last_message_at: datetime | None
    is_member: bool


class CaseRefOut(BaseModel):
    id: uuid.UUID
    case_code: str
    title: str
    status: str


class PrecedentOut(BaseModel):
    case_code: str
    title: str
    similarity_score: int
    how_past_case_went: str
    lead_name: str | None
    lead_is_alumni: bool


class PinnedCaseOut(CaseRefOut):
    initial_request_brief: str
    precedents: list[PrecedentOut]


class AccessRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user: PersonOut
    status: str
    created_at: datetime


class AccessDecisionIn(BaseModel):
    approve: bool


class TicketIn(BaseModel):
    room: str  # a department id, or "case-<uuid>" for a case channel


class TicketOut(BaseModel):
    ticket: str


class RoomViewOut(BaseModel):
    """Everything the War Room screen renders for one room, in one request."""

    department_id: str
    name: str
    code: str
    lead_user_id: uuid.UUID | None
    is_member: bool
    members: list[MemberOut]
    pinned_case: PinnedCaseOut | None
    case_options: list[CaseRefOut]
    threads: list[ThreadSummaryOut]
    messages: list[MessageOut]
    last_read_seq: int
    access_requests: list[AccessRequestOut] = []
    my_access_request: AccessRequestOut | None = None


class MessageIn(BaseModel):
    id: uuid.UUID  # client-generated: retries are idempotent
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    is_milestone: bool = False


class PinIn(BaseModel):
    case_id: uuid.UUID | None


class ReadIn(BaseModel):
    seq: int
