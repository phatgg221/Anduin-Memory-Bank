import asyncio
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import literal, select, text, update
from sqlalchemy.dialects.postgresql import JSONB, distinct_on, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import documents, realtime, storage
from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.auth.models import User
from app.modules.cases import service as cases
from app.modules.cases.models import CaseRecord, ChannelMessage, CopilotMessage
from app.modules.cases.schemas import ThreadMessageOut
from app.modules.intelligence import analyzer, copilot, curator, indexer, llm_client, summarizer, triage_agent
from app.modules.intelligence.guard import guard_memory
from app.modules.intelligence.schemas import (
    CaseMemoryDraft,
    CaseMemoryRecord,
    IncomingRequest,
    ThreadContext,
    TranscriptMessage,
)
from app.modules.intelligence.transcript import build_transcript
from app.modules.org.models import Department
from app.modules.rooms import service as rooms
from app.modules.triage.models import CaseJob

MENTION = re.compile(r"@dejavu\b", re.IGNORECASE)

STEPS = {
    "ANALYZE": triage_agent.TRIAGE_STEPS,
    "SUMMARIZE": (*summarizer.SUMMARIZE_STEPS, curator.CURATE_STEP),
    "EXTRACT": ("Converting files to Markdown",),
    "INDEX": indexer.INDEX_STEPS,
    "COPILOT": copilot.COPILOT_STEPS,
}

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
    session: AsyncSession,
    job_id: uuid.UUID,
    case_id: uuid.UUID,
    kind: str,
    user: User | None,
    job_input: dict | None = None,
) -> CaseJob:
    """Idempotent: a retried request (same id) or a second click while a job is live returns the existing job."""
    if existing := await session.get(CaseJob, job_id):
        return existing
    statement = (
        insert(CaseJob)
        .values(id=job_id, case_id=case_id, kind=kind, requested_by_user_id=user.id if user else None, input=job_input)
        .on_conflict_do_nothing()
    )
    await session.execute(statement)
    await session.commit()
    if kind == "COPILOT":
        return await session.get_one(CaseJob, job_id)
    live = await session.scalar(
        select(CaseJob).where(
            CaseJob.case_id == case_id, CaseJob.kind == kind, CaseJob.status.in_(("QUEUED", "PROCESSING"))
        )
    )
    return live or await session.get_one(CaseJob, job_id)


async def request_extract(session: AsyncSession, user: User, case_id: uuid.UUID) -> CaseJob:
    """One live EXTRACT per case; it keeps going until no file is PENDING, so later uploads are picked up too."""
    return await enqueue(session, uuid.uuid4(), case_id, "EXTRACT", user)


async def request_summary(
    session: AsyncSession,
    user: User,
    case_id: uuid.UUID,
    job_id: uuid.UUID,
    outcome: str | None = None,
    final_output: str | None = None,
    deliverable_file_ids: list[uuid.UUID] | None = None,
) -> CaseJob:
    case = await session.get(CaseRecord, case_id)
    if case is None:
        raise NotFoundError("Unknown case")
    if case.status != "OPEN":
        raise ConflictError("This case is already resolved")
    has_messages = await session.scalar(select(ChannelMessage.id).where(ChannelMessage.case_id == case_id).limit(1))
    if has_messages is None:
        raise ConflictError("The thread has no messages yet, so there's nothing to summarize")
    job_input = {
        "outcome": outcome,
        "final_output": final_output,
        "deliverable_file_ids": [str(i) for i in deliverable_file_ids or []],
    }
    return await enqueue(session, job_id, case_id, "SUMMARIZE", user, job_input)


async def request_analysis(session: AsyncSession, user: User, case_id: uuid.UUID, job_id: uuid.UUID) -> CaseJob:
    case = await session.get(CaseRecord, case_id)
    if case is None:
        raise NotFoundError("Unknown case")
    if case.status != "OPEN":
        raise ConflictError("This case is already resolved")
    return await enqueue(session, job_id, case_id, "ANALYZE", user)


async def ask_copilot(
    session: AsyncSession,
    user: User,
    case_id: uuid.UUID,
    message_id: uuid.UUID,
    job_id: uuid.UUID,
    question: str,
    reply_in_channel: bool = False,
) -> CaseJob:
    """Stores the question (idempotent on its id) and queues the answer job.

    With @Dejavu in the case channel the question is already a channel message, and the answer is posted there.
    """
    if await session.get(CaseRecord, case_id) is None:
        raise NotFoundError("Unknown case")
    if existing := await session.get(CaseJob, job_id):
        return existing
    if reply_in_channel:
        question = MENTION.sub("", question).strip() or "Summarise where this case stands and what to do next."
    elif not await session.get(CopilotMessage, message_id):
        await cases.add_copilot_message(session, case_id, "user", question, message_id=message_id, user_id=user.id)
    job_input = {"question": question, "message_id": str(message_id), "reply_in_channel": reply_in_channel}
    return await enqueue(session, job_id, case_id, "COPILOT", user, job_input)


async def copilot_view(session: AsyncSession, case_id: uuid.UUID) -> tuple[list, list[CaseJob]]:
    messages = await cases.copilot_messages(session, case_id)
    pending = list(
        await session.scalars(
            select(CaseJob)
            .where(CaseJob.case_id == case_id, CaseJob.kind == "COPILOT")
            .where(CaseJob.status.in_(("QUEUED", "PROCESSING", "FAILED")))
            .order_by(CaseJob.created_at)
        )
    )
    return messages, pending


async def latest_jobs(session: AsyncSession, case_id: uuid.UUID) -> dict[str, CaseJob | None]:
    jobs = await session.scalars(
        select(CaseJob)
        .where(CaseJob.case_id == case_id)
        .order_by(CaseJob.kind, CaseJob.created_at.desc())
        .ext(distinct_on(CaseJob.kind))
    )
    by_kind = {job.kind: job for job in jobs}
    return {"analyze": by_kind.get("ANALYZE"), "summarize": by_kind.get("SUMMARIZE"), "index": by_kind.get("INDEX")}


# --- commit (human-reviewed record → RESOLVED, then INDEX) -------------------------------------------------------


async def commit(
    session: AsyncSession, user: User, case_id: uuid.UUID, draft: CaseMemoryDraft
) -> tuple[CaseRecord, CaseJob, list[str]]:
    """The reviewer's edits are re-guarded (references re-checked, IDs re-derived by code) before they're stored."""
    context, _ = await _thread_context(session, case_id)
    record, warnings = guard_memory(draft, context, build_transcript(context))
    try:
        case = await cases.commit_memory(
            session,
            case_id,
            record.model_dump(),
            user.id,
            outcome=getattr(draft, "outcome", None),
            final_output=getattr(draft, "final_output", None),
            reusable_file_ids=getattr(draft, "reusable_file_ids", None),
        )
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
    permanent = isinstance(error, PermanentError | summarizer.EmptyThreadError | analyzer.NoPrecedentsError)
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
        handler = {
            "ANALYZE": _analyze,
            "SUMMARIZE": _summarize,
            "INDEX": _index,
            "COPILOT": _copilot,
            "EXTRACT": _extract,
        }[kind]
        result = await handler(job_id, case_id)
    except llm_client.LLMError as error:
        message = str(error)
        retryable = "unavailable" in message or "never returned valid" in message
        await record_failure(job_id, error if retryable else PermanentError(message))
        return
    except Exception as error:  # noqa: BLE001 — recorded on the job; the worker keeps running
        await record_failure(job_id, error)
        return
    await complete(job_id, result)


async def append_trace(job_id: uuid.UUID, event: dict[str, Any]) -> None:
    """One more line on the live investigation screen; also counts as a heartbeat."""
    item = json.loads(json.dumps([triage_agent.new_trace_event(event)], default=str))
    async with SessionLocal.begin() as session:
        await session.execute(
            update(CaseJob)
            .where(CaseJob.id == job_id)
            .values(trace=CaseJob.trace.op("||")(literal(item, JSONB)), heartbeat_at=datetime.now(UTC))
        )


def _incoming(case: CaseRecord, file_texts: dict[str, str]) -> IncomingRequest:
    return IncomingRequest(
        case_code=case.case_code,
        title=case.title,
        client_name=case.client_name,
        fund_name=case.fund_name,
        source_type=case.source_type,
        brief=case.initial_request_brief,
        context_tags=case.context_tags,
        file_texts=file_texts,
    )


async def _index_intake(session: AsyncSession, case: CaseRecord, incoming: IncomingRequest) -> tuple[int, int]:
    """Embeds this request (and any open case not indexed yet) into pgvector, so duplicates are searchable."""
    batch = [(case, incoming)]
    for other in await cases.open_cases_without_chunks(session):
        if other.id != case.id:
            texts = {a.file_name: a.preview_text for a in other.artifacts if a.preview_text}
            batch.append((other, _incoming(other, texts)))
    drafts = [(target, indexer.build_intake_chunks(request)) for target, request in batch]
    await indexer.embed_chunks([chunk for _, chunks in drafts for chunk in chunks])
    artifact_ids = await cases.artifact_ids_by_name(session, [target.id for target, _ in batch])
    for target, chunks in drafts:
        rows = [
            {
                "chunk_type": c.chunk_type,
                "reference_label": c.reference_label,
                "content": c.content,
                "embedding": c.embedding,
                "artifact_id": artifact_ids.get((target.id, c.artifact_name)) if c.artifact_name else None,
            }
            for c in chunks
        ]
        await cases.replace_chunks(session, target, rows)
    return len(drafts[0][1]), len(batch) - 1


async def extract_pending(case_id: uuid.UUID, job_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    """Converts every PENDING file of the case to Markdown (MarkItDown, off the event loop). Safe to run twice."""
    converted: list[dict[str, Any]] = []
    for _ in range(10):  # re-check: files uploaded while we were converting are picked up too
        async with SessionLocal() as session:
            pending = [(a.id, a.file_name, a.minio_object_key) for a in await cases.pending_artifacts(session, case_id)]
        if not pending:
            break
        for artifact_id, name, key in pending:
            if job_id:
                await heartbeat(job_id, STEPS["EXTRACT"][0])
            try:
                data = await asyncio.to_thread(storage.read_object, key)
                text = await asyncio.to_thread(documents.extract_text, name, data)
            except Exception:  # noqa: BLE001 — an unreadable file mustn't block the case
                text = None
            async with SessionLocal() as session:
                await cases.set_artifact_text(session, artifact_id, text)
            converted.append({"file_name": name, "chars": len(text or ""), "readable": bool(text)})
    if converted:
        await realtime.room_changed(realtime.thread_room(case_id), "threads")
    return converted


async def _extract(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    return {"files": await extract_pending(case_id, job_id)}


async def _analyze(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    """The triage agent: index the request, rank precedents (code), investigate with tools, write a guarded report."""
    async with SessionLocal.begin() as session:
        await session.execute(update(CaseJob).where(CaseJob.id == job_id).values(trace=[]))
    await heartbeat(job_id, triage_agent.TRIAGE_STEPS[0])
    trace = lambda event: append_trace(job_id, event)  # noqa: E731
    if converted := await extract_pending(case_id):
        await trace(
            {
                "tool": "index",
                "label": "Converted files to Markdown",
                "detail": " · ".join(f"{c['file_name']} ({c['chars']:,} chars)" for c in converted),
            }
        )

    async with SessionLocal() as session:
        case = await session.get_one(CaseRecord, case_id)
        incoming = _incoming(case, await cases.case_files_text(session, case_id))
        files = len(incoming.file_texts)
        chunks, others = await _index_intake(session, case, incoming)
        await trace(
            {
                "tool": "index",
                "label": "Read and indexed the request",
                "detail": f"Brief{f' + {files} file' + ('s' if files != 1 else '') if files else ''} → {chunks} "
                f"chunk{'s' if chunks != 1 else ''} in pgvector"
                + (f" · {others} other open case{'s' if others != 1 else ''} indexed" if others else ""),
            }
        )
        departments = [case.department_id, *case.secondary_department_ids]
        precedents = await analyzer.rank_precedents(session, incoming, departments, case_id)
        if not precedents:
            raise analyzer.NoPrecedentsError("The Memory Bank has no indexed cases to compare against yet.")
        await trace(
            {
                "tool": "rank",
                "label": "Ranked precedents (vector + metadata)",
                "detail": " · ".join(f"{p.case_code} {p.similarity}%" for p in precedents),
            }
        )

        await heartbeat(job_id, triage_agent.TRIAGE_STEPS[1])
        evidence = await triage_agent.investigate(session, case, incoming, precedents, trace)
        severity = case.severity

    await heartbeat(job_id, triage_agent.TRIAGE_STEPS[2])
    model = settings.agent_model or None
    (results, delta_warnings), (report, report_warnings) = await asyncio.gather(
        analyzer.compare(incoming, precedents, model=model),
        triage_agent.write_report(incoming, precedents, evidence, severity),
    )
    await heartbeat(job_id, triage_agent.TRIAGE_STEPS[3])
    warnings = delta_warnings + report_warnings
    await trace(
        {
            "tool": "guard",
            "label": "Checked sources and scores",
            "detail": f"{len(warnings)} unverifiable reference(s) removed" if warnings else "All references verified",
        }
    )
    async with SessionLocal() as session:
        await cases.set_comparison_results(session, case_id, results)
        await cases.set_triage_report(session, case_id, report)
    return {
        "matches": [{"caseCode": r["caseCode"], "similarityScore": r["similarityScore"]} for r in results],
        "guard_warnings": warnings,
        "tool_calls": evidence.tool_calls,
        "provider": llm_client.agent_label(),
        "embedding_model": llm_client.embedding_label(),
    }


async def _copilot(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    await heartbeat(job_id, copilot.COPILOT_STEPS[0])
    async with SessionLocal() as session:
        job = await session.get_one(CaseJob, job_id)
        question = (job.input or {}).get("question", "")
        in_channel = bool((job.input or {}).get("reply_in_channel"))
        thread, case = await _thread_context(session, case_id)
        history = (
            [] if in_channel else [(m.role, m.content) for m in await cases.copilot_messages(session, case_id)][:-1]
        )
        context = copilot.CopilotContext(
            channel=build_transcript(thread).text if thread.messages else "",
            case_block=(
                f"{case.case_code} · {case.title}\nCustomer: {case.client_name} · Fund: {case.fund_name}\n"
                f"Severity: {case.severity} · Status: {case.status}\n{case.initial_request_brief}"
            ),
            precedents=await cases.precedents_for(session, case),
            history=history,
        )
        result = await copilot.answer(session, context, question, lambda step: heartbeat(job_id, step))
        if in_channel:
            posted = await cases.post_agent_message(session, case_id, job_id, result["answer"])
            out = ThreadMessageOut.model_validate(posted).model_dump(mode="json")
            await realtime.publish(realtime.thread_room(case_id), {"type": "message.created", "message": out})
            return {
                "channel_message_id": str(posted.id),
                "uncited_case_codes": result["uncited_case_codes"],
                "provider": llm_client.provider_label(),
            }
        message = await cases.add_copilot_message(
            session,
            case_id,
            "assistant",
            result["answer"],
            cited_case_ids=result["cited_case_ids"],
            cited_artifact_ids=result["cited_artifact_ids"],
        )
    return {
        "message_id": str(message.id),
        "uncited_case_codes": result["uncited_case_codes"],
        "provider": llm_client.provider_label(),
    }


async def _summarize(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    """The memory curator: draft the record from the thread + the team's outcome, then suggest reusable files and
    check the new lessons against older memory."""
    await extract_pending(case_id)  # approval / output files dropped at commit time are read first
    async with SessionLocal() as session:
        job = await session.get_one(CaseJob, job_id)
        given = job.input or {}
        context, case = await _thread_context(session, case_id)
        deliverable_ids = set(given.get("deliverable_file_ids") or [])
        context.outcome = given.get("outcome")
        context.final_output = given.get("final_output")
        context.deliverables = [a.file_name for a in case.artifacts if str(a.id) in deliverable_ids]
        context.approvals = [a.file_name for a in case.artifacts if a.file_type == "CLIENT_APPROVAL"]
        context.deliverable_texts = {
            a.file_name: (a.file_type, a.preview_text)
            for a in case.artifacts
            if str(a.id) in deliverable_ids and a.preview_text
        }
        files = {a.file_name: (str(a.id), a.preview_text or a.description or "") for a in case.artifacts}
    record, warnings = await summarizer.summarize_thread(context, lambda step: heartbeat(job_id, step))
    await heartbeat(job_id, curator.CURATE_STEP)
    async with SessionLocal() as session:
        suggestions, curator_warnings = await curator.curate(session, case_id, context, record, files)
    return {
        "record": record.model_dump(),
        "guard_warnings": warnings + curator_warnings,
        "provider": llm_client.provider_label(),
        "outcome": context.outcome,
        "final_output": context.final_output,
        "deliverable_file_ids": sorted(deliverable_ids),
        "curator": suggestions,
    }


async def _index(job_id: uuid.UUID, case_id: uuid.UUID) -> dict[str, Any]:
    await heartbeat(job_id, indexer.INDEX_STEPS[0])
    async with SessionLocal() as session:
        context, case = await _thread_context(session, case_id)
        context.outcome, context.final_output = case.outcome, case.final_output
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
        agent = getattr(message, "is_agent", False)
        return TranscriptMessage(
            id=message.id,
            author_id=author.id if author else None,
            author_name=author.name if author else ("Dejavu copilot (AI)" if agent else "Former member"),
            author_title=author.job_title if author else None,
            author_active=author.is_active if author else agent,
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
