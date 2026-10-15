import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import distinct_on, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.auth.models import User
from app.modules.cases import service as cases
from app.modules.cases.models import CaseRecord, ChannelMessage
from app.modules.intelligence import indexer, llm_client, summarizer
from app.modules.intelligence.guard import guard_memory
from app.modules.intelligence.schemas import CaseMemoryDraft, CaseMemoryRecord, ThreadContext, TranscriptMessage
from app.modules.intelligence.transcript import build_transcript
from app.modules.org.models import Department
from app.modules.rooms import service as rooms
from app.modules.triage.models import CaseJob

STEPS = {"SUMMARIZE": summarizer.SUMMARIZE_STEPS, "INDEX": indexer.INDEX_STEPS}

CLAIM_SQL = text("""
    UPDATE case_jobs
       SET status = 'PROCESSING', attempts = attempts + 1, heartbeat_at = now(), updated_at = now(), error = NULL
     WHERE id = (SELECT id FROM case_jobs
                  WHERE status = 'QUEUED'
                  ORDER BY created_at
                  LIMIT 1
                  FOR UPDATE SKIP LOCKED)
 RETURNING id
""")


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class PermanentError(Exception):
    """Retrying won't help (empty thread, missing API key, rejected request): fail the job straight away."""


# --- enqueue & read ----------------------------------------------------------------------------------------------


async def enqueue(
    session: AsyncSession, job_id: uuid.UUID, case_id: uuid.UUID, kind: str, user: User | None
) -> CaseJob:
    """Idempotent: a retried request (same id) or a second click while a job is live returns the existing job."""
    if existing := await session.get(CaseJob, job_id):
        return existing
    statement = (
        insert(CaseJob)
        .values(id=job_id, case_id=case_id, kind=kind, requested_by_user_id=user.id if user else None)
        .on_conflict_do_nothing()
    )
    await session.execute(statement)
    await session.commit()
    live = await session.scalar(
        select(CaseJob).where(
            CaseJob.case_id == case_id, CaseJob.kind == kind, CaseJob.status.in_(("QUEUED", "PROCESSING"))
        )
    )
    return live or await session.get_one(CaseJob, job_id)


async def request_summary(session: AsyncSession, user: User, case_id: uuid.UUID, job_id: uuid.UUID) -> CaseJob:
    case = await session.get(CaseRecord, case_id)
    if case is None:
        raise NotFoundError("Unknown case")
    if case.status != "OPEN":
        raise ConflictError("This case is already resolved")
    has_messages = await session.scalar(select(ChannelMessage.id).where(ChannelMessage.case_id == case_id).limit(1))
    if has_messages is None:
        raise ConflictError("The thread has no messages yet, so there's nothing to summarize")
    return await enqueue(session, job_id, case_id, "SUMMARIZE", user)


async def latest_jobs(session: AsyncSession, case_id: uuid.UUID) -> dict[str, CaseJob | None]:
    jobs = await session.scalars(
        select(CaseJob)
        .where(CaseJob.case_id == case_id)
        .order_by(CaseJob.kind, CaseJob.created_at.desc())
        .ext(distinct_on(CaseJob.kind))
    )
    by_kind = {job.kind: job for job in jobs}
    return {"summarize": by_kind.get("SUMMARIZE"), "index": by_kind.get("INDEX")}


# --- commit (human-reviewed record → RESOLVED, then INDEX) -------------------------------------------------------


async def commit(
    session: AsyncSession, user: User, case_id: uuid.UUID, draft: CaseMemoryDraft
) -> tuple[CaseRecord, CaseJob, list[str]]:
    """The reviewer's edits are re-guarded (references re-checked, IDs re-derived by code) before they're stored."""
    context, _ = await _thread_context(session, case_id)
    record, warnings = guard_memory(draft, context, build_transcript(context))
    try:
        case = await cases.commit_memory(session, case_id, record.model_dump(), user.id)
    except cases.ConflictError as error:
        raise ConflictError(str(error)) from None
    job = await enqueue(session, uuid.uuid4(), case_id, "INDEX", user)
    return case, job, warnings


# --- worker side -------------------------------------------------------------------------------------------------


async def claim_next() -> uuid.UUID | None:
    async with SessionLocal.begin() as session:
        return await session.scalar(CLAIM_SQL)


async def heartbeat(job_id: uuid.UUID, step: str) -> None:
    async with SessionLocal.begin() as session:
        await session.execute(
            update(CaseJob)
            .where(CaseJob.id == job_id, CaseJob.status == "PROCESSING")
            .values(step=step, heartbeat_at=datetime.now(UTC))
        )


async def complete(job_id: uuid.UUID, result: dict[str, Any]) -> None:
    async with SessionLocal.begin() as session:
        await session.execute(
            update(CaseJob).where(CaseJob.id == job_id).values(status="COMPLETED", result=result, step=None, error=None)
        )


async def record_failure(job_id: uuid.UUID, error: Exception) -> None:
    """Requeue while attempts remain, unless retrying can't help."""
    permanent = isinstance(error, PermanentError | summarizer.EmptyThreadError)
    async with SessionLocal.begin() as session:
        job = await session.get(CaseJob, job_id, with_for_update=True)
        if job is None:
            return
        give_up = permanent or job.attempts >= settings.job_max_attempts
        job.status = "FAILED" if give_up else "QUEUED"
        job.error = str(error)[:2000] or type(error).__name__


async def sweep_once() -> int:
    """PROCESSING jobs with a stale heartbeat (e.g. the API restarted mid-job) → QUEUED, or FAILED once out of tries."""
    cutoff = datetime.now(UTC) - timedelta(seconds=settings.job_stale_after_seconds)
    async with SessionLocal.begin() as session:
        result = await session.execute(
            text("""
                UPDATE case_jobs
                   SET status = CASE WHEN attempts >= :max THEN 'FAILED' ELSE 'QUEUED' END,
                       error  = CASE WHEN attempts >= :max THEN 'Gave up after repeated stalls' ELSE error END
                 WHERE status = 'PROCESSING' AND heartbeat_at < :cutoff
            """),
            {"max": settings.job_max_attempts, "cutoff": cutoff},
        )
        return result.rowcount


async def process(job_id: uuid.UUID) -> None:
    """Runs one claimed job to COMPLETED, or records the failure."""
    async with SessionLocal() as session:
        job = await session.get(CaseJob, job_id)
        if job is None:
            return
        kind, case_id = job.kind, job.case_id
    try:
        result = await (_summarize if kind == "SUMMARIZE" else _index)(job_id, case_id)
    except llm_client.LLMError as error:
        message = str(error)
        retryable = "unavailable" in message or "never returned valid" in message
        await record_failure(job_id, error if retryable else PermanentError(message))
        return
    except Exception as error:  # noqa: BLE001 — recorded on the job; the worker keeps running
        await record_failure(job_id, error)
        return
    await complete(job_id, result)


async def _summarize(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    async with SessionLocal() as session:
        context, _ = await _thread_context(session, case_id)
    record, warnings = await summarizer.summarize_thread(context, lambda step: heartbeat(job_id, step))
    return {"record": record.model_dump(), "guard_warnings": warnings, "provider": llm_client.provider_label()}


async def _index(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    await heartbeat(job_id, indexer.INDEX_STEPS[0])
    async with SessionLocal() as session:
        context, case = await _thread_context(session, case_id)
        record = CaseMemoryRecord(
            summary=case.summary or "",
            how_it_went=case.how_it_went or "",
            resolution_steps=case.resolution_steps,
            pitfalls=case.pitfalls,
            context_tags=case.context_tags,
        )
        artifacts = {a.file_name: a.preview_text for a in case.artifacts if a.preview_text}
        artifact_ids = {a.file_name: a.id for a in case.artifacts}
    chunks = indexer.build_chunks(context, record, artifacts)
    await heartbeat(job_id, indexer.INDEX_STEPS[1])
    await indexer.embed_chunks(chunks)
    await heartbeat(job_id, indexer.INDEX_STEPS[2])
    rows = [
        {
            "chunk_type": c.chunk_type,
            "reference_label": c.reference_label,
            "content": c.content,
            "embedding": c.embedding,
            "message_id": c.message_id,
            "artifact_id": artifact_ids.get(c.artifact_name) if c.artifact_name else None,
        }
        for c in chunks
    ]
    async with SessionLocal() as session:
        case = await session.get_one(CaseRecord, case_id)
        count = await cases.replace_chunks(session, case, rows)
    return {"chunks": count, "embedding_provider": settings.embedding_provider}


async def _thread_context(session: AsyncSession, case_id: uuid.UUID) -> tuple[ThreadContext, CaseRecord]:
    try:
        case, messages = await cases.load_for_memory(session, case_id)
    except cases.NotFoundError as error:
        raise NotFoundError(str(error)) from None
    department = await session.get(Department, case.department_id)
    mentions = await rooms.mentions_of(session, case.case_code)

    def to_transcript(message, attachment=None) -> TranscriptMessage:
        author = message.author
        return TranscriptMessage(
            id=message.id,
            author_id=author.id if author else None,
            author_name=author.name if author else "Former member",
            author_title=author.job_title if author else None,
            author_active=author.is_active if author else False,
            content=message.content,
            created_at=message.created_at,
            is_milestone=getattr(message, "is_resolution_milestone", False),
            attachment=attachment,
        )

    context = ThreadContext(
        case_code=case.case_code,
        title=case.title,
        department=department.name if department else case.department_id,
        initial_request_brief=case.initial_request_brief,
        context_tags=case.context_tags,
        client_name=case.client_name,
        severity=case.severity,
        due_date=case.due_date.isoformat() if case.due_date else None,
        messages=[to_transcript(m, m.attached_artifact.file_name if m.attached_artifact else None) for m in messages],
        artifacts=[a.file_name for a in case.artifacts],
        room_mentions=[to_transcript(m) for m in mentions],
    )
    return context, case
