import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, computed_field

from app.modules.intelligence.schemas import CaseMemoryDraft
from app.modules.triage.service import STEPS


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    kind: str
    status: str
    step: str | None
    attempts: int
    error: str | None
    result: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    input: dict[str, Any] | None = Field(default=None, exclude=True)
    trace: list[dict[str, Any]] = []

    @computed_field
    @property
    def in_channel(self) -> bool:
        """A copilot question asked with @Dejavu in the case channel; the answer is posted there."""
        return bool((self.input or {}).get("reply_in_channel"))

    @computed_field
    @property
    def steps(self) -> list[str]:
        """Every step of this kind, so the UI shows progress as a checklist, not a spinner."""
        return list(STEPS[self.kind])


class CaseJobsOut(BaseModel):
    analyze: JobOut | None
    summarize: JobOut | None
    index: JobOut | None


class AnalyzeIn(BaseModel):
    job_id: uuid.UUID


class CopilotAskIn(BaseModel):
    message_id: uuid.UUID  # the question's id (client-generated)
    job_id: uuid.UUID  # the answer job's id (client-generated)
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=4000)]
    reply_in_channel: bool = False  # asked with @Dejavu: message_id is the channel message, the answer goes there


class CopilotMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    user_id: uuid.UUID | None
    cited_case_ids: list[str]
    cited_artifact_ids: list[str]
    created_at: datetime


class CopilotViewOut(BaseModel):
    messages: list[CopilotMessageOut]
    jobs: list[JobOut]  # questions still being answered (or failed)


Outcome = Literal["RESOLVED", "WORKAROUND", "PARTIAL", "ESCALATED", "WITHDRAWN"]
FinalOutput = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2000)]


class ResolveIn(BaseModel):
    job_id: uuid.UUID  # client-generated: a double click or retry returns the same job
    # Asked before drafting: how the case ended and what was delivered. The summarizer writes from it.
    outcome: Outcome | None = None
    final_output: FinalOutput | None = None
    deliverable_file_ids: Annotated[list[uuid.UUID], Field(max_length=20)] = []


class CommitIn(CaseMemoryDraft):
    """The reviewed (possibly edited) draft. References are re-checked and IDs re-derived on the server."""

    outcome: Outcome | None = None
    final_output: FinalOutput | None = None
    # This case's files to mark reusable in the Knowledge Base (explicit state: the rest are marked not reusable).
    reusable_file_ids: Annotated[list[uuid.UUID], Field(max_length=50)] | None = None


class CommitOut(BaseModel):
    case_id: uuid.UUID
    case_code: str
    status: str
    index_job: JobOut
    guard_warnings: list[str]
