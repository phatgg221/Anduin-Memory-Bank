import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, StringConstraints, computed_field

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
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=2000)]


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


class ResolveIn(BaseModel):
    job_id: uuid.UUID  # client-generated: a double click or retry returns the same job


class CommitIn(CaseMemoryDraft):
    """The reviewed (possibly edited) draft. References are re-checked and IDs re-derived on the server."""


class CommitOut(BaseModel):
    case_id: uuid.UUID
    case_code: str
    status: str
    index_job: JobOut
    guard_warnings: list[str]
