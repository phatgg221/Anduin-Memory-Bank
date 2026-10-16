import uuid

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.storage import presigned_get
from app.modules.cases.models import CaseArtifact, CaseRecord
from app.modules.org.models import Department

INLINE_TYPES = ("application/pdf", "text/plain", "text/markdown")


class ArtifactNotFoundError(Exception):
    pass


def _in_department(department_id: str | ColumnElement[str]) -> ColumnElement[bool]:
    # A case belongs to its owning department and to every department it involves.
    return or_(
        CaseRecord.department_id == department_id,
        CaseRecord.secondary_department_ids.contains(func.jsonb_build_array(department_id)),
    )


async def vault_view(session: AsyncSession, department_id: str | None) -> tuple[list[CaseRecord], dict[str, int], int]:
    """A fixed number of queries whatever the row count: cases, their leads and artifacts (selectinload), counts."""
    resolved = CaseRecord.status == "RESOLVED"
    query = (
        select(CaseRecord)
        .where(resolved)
        .options(selectinload(CaseRecord.lead_resolver), selectinload(CaseRecord.artifacts))
        .order_by(CaseRecord.resolved_at.desc().nulls_last(), CaseRecord.created_at.desc())
    )
    if department_id is not None:
        query = query.where(_in_department(department_id))
    cases = list(await session.scalars(query))

    counts_query = (
        select(Department.id, func.count(CaseRecord.id))
        .select_from(Department)
        .outerjoin(CaseRecord, resolved & _in_department(Department.id))
        .group_by(Department.id)
    )
    counts = {dept: count for dept, count in await session.execute(counts_query)}
    total = await session.scalar(select(func.count()).select_from(CaseRecord).where(resolved)) or 0
    return cases, counts, total


async def artifact_link(session: AsyncSession, artifact_id: uuid.UUID) -> tuple[str, int]:
    artifact = await session.get(CaseArtifact, artifact_id)
    if artifact is None:
        raise ArtifactNotFoundError
    disposition = "inline" if artifact.content_type in INLINE_TYPES else "attachment"
    return presigned_get(artifact.minio_object_key, artifact.file_name, disposition), settings.presign_ttl_seconds
