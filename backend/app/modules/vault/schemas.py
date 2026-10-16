import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    avatar_initials: str
    job_title: str | None
    is_active: bool
    departed_at: date | None


class ArtifactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_name: str
    file_type: str
    content_type: str
    size_bytes: int
    is_reusable: bool
    description: str


class VaultCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_code: str
    title: str
    department_id: str
    secondary_department_ids: list[str]
    context_tags: dict[str, str]
    summary: str | None
    outcome: str | None = None
    final_output: str | None = None
    duration_days: int | None
    created_at: datetime
    resolved_at: datetime | None
    lead_resolver: PersonOut | None
    artifacts: list[ArtifactOut]


class VaultViewOut(BaseModel):
    """Knowledge Vault screen: resolved cases for one department (or all), plus per-department counts."""

    department_id: str | None
    total: int
    counts: dict[str, int]
    cases: list[VaultCaseOut]


class ArtifactLinkOut(BaseModel):
    url: str
    expires_in: int
