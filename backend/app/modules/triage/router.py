import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status

from app.core import realtime
from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser
from app.modules.cases import service as cases
from app.modules.cases.schemas import ArtifactRefOut
from app.modules.intelligence import llm_client, retrieval
from app.modules.triage import service
from app.modules.triage.schemas import (
    AnalyzeIn,
    CaseJobsOut,
    CommitIn,
    CommitOut,
    CopilotAskIn,
    CopilotMessageOut,
    CopilotViewOut,
    JobOut,
    ResolveIn,
)

router = APIRouter(prefix="/cases", tags=["memory"])
memory_router = APIRouter(prefix="/memory", tags=["memory"])
UPLOAD_ERRORS = {
    cases.NotFoundError: status.HTTP_404_NOT_FOUND,
    cases.ConflictError: status.HTTP_409_CONFLICT,
    cases.InvalidError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    cases.ForbiddenError: status.HTTP_403_FORBIDDEN,
}


def _http(error: Exception) -> HTTPException:
    if isinstance(error, service.ForbiddenError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(error))
    code = status.HTTP_404_NOT_FOUND if isinstance(error, service.NotFoundError) else status.HTTP_409_CONFLICT
    return HTTPException(code, str(error))


@router.post("/{case_id}/resolve", status_code=status.HTTP_202_ACCEPTED)
async def resolve(case_id: uuid.UUID, data: ResolveIn, user: CurrentUser, session: SessionDep) -> JobOut:
    """Starts the SUMMARIZE job. Poll GET /cases/{id}/jobs for progress; the draft lands on the job for review."""
    try:
        job = await service.request_summary(
            session, user, case_id, data.job_id, data.outcome, data.final_output, data.deliverable_file_ids
        )
    except (service.NotFoundError, service.ConflictError, service.ForbiddenError) as error:
        raise _http(error) from None
    return JobOut.model_validate(job)


@router.get("/{case_id}/jobs")
async def case_jobs(case_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> CaseJobsOut:
    jobs = await service.latest_jobs(session, case_id, user)
    return CaseJobsOut(**{kind: JobOut.model_validate(job) if job else None for kind, job in jobs.items()})


@router.post("/{case_id}/analyze", status_code=status.HTTP_202_ACCEPTED)
async def analyze(case_id: uuid.UUID, data: AnalyzeIn, user: CurrentUser, session: SessionDep) -> JobOut:
    """Starts precedent matching: top-3 past cases + delta, written to the case. Poll GET /cases/{id}/jobs."""
    try:
        job = await service.request_analysis(session, user, case_id, data.job_id)
    except (service.NotFoundError, service.ConflictError, service.ForbiddenError) as error:
        raise _http(error) from None
    return JobOut.model_validate(job)


@router.get("/{case_id}/copilot")
async def copilot_view(case_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> CopilotViewOut:
    try:
        messages, jobs = await service.copilot_view(session, case_id, user)
    except service.ForbiddenError as error:
        raise _http(error) from None
    return CopilotViewOut(
        messages=[CopilotMessageOut.model_validate(m) for m in messages],
        jobs=[JobOut.model_validate(j) for j in jobs],
    )


@router.post("/{case_id}/copilot", status_code=status.HTTP_202_ACCEPTED)
async def ask_copilot(case_id: uuid.UUID, data: CopilotAskIn, user: CurrentUser, session: SessionDep) -> JobOut:
    """Asks the Memory Copilot about this case. The answer arrives as a copilot message when the job completes."""
    try:
        job = await service.ask_copilot(
            session, user, case_id, data.message_id, data.job_id, data.question, data.reply_in_channel
        )
    except (service.NotFoundError, service.ForbiddenError) as error:
        raise _http(error) from None
    except service.RateLimitedError as error:
        headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(error), headers=headers) from None
    return JobOut.model_validate(job)


@router.post("/{case_id}/commit")
async def commit(case_id: uuid.UUID, data: CommitIn, user: CurrentUser, session: SessionDep) -> CommitOut:
    """Commits the reviewed record: the case becomes RESOLVED (thread read-only) and an INDEX job starts."""
    try:
        case, job, warnings = await service.commit(session, user, case_id, data)
    except (service.NotFoundError, service.ConflictError, service.ForbiddenError) as error:
        raise _http(error) from None
    await realtime.room_changed(realtime.thread_room(case_id), "threads")
    for department_id in [case.department_id, *case.secondary_department_ids]:
        await realtime.room_changed(department_id, "threads")
    return CommitOut(
        case_id=case.id,
        case_code=case.case_code,
        status=case.status,
        index_job=JobOut.model_validate(job),
        guard_warnings=warnings,
    )


@memory_router.get("/search")
async def search_memory(
    user: CurrentUser,
    session: SessionDep,
    q: Annotated[str, Query(min_length=3, max_length=2000)],
    department_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
) -> dict:
    """Semantic search over committed case memory (RAG retrieval). Similarity = 1 - cosine distance, in %."""
    try:
        return await retrieval.search(session, q, department_id, limit)
    except llm_client.LLMError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Embedding provider unavailable: {error}") from None


@router.post("/{case_id}/files", status_code=status.HTTP_201_CREATED)
async def upload_file(
    case_id: uuid.UUID,
    file: Annotated[UploadFile, File()],
    user: CurrentUser,
    session: SessionDep,
    file_type: Annotated[str, Form(pattern=r"^[A-Z_]{3,30}$")] = "CLIENT_BRIEF",
) -> ArtifactRefOut:
    """Stores the file and returns at once (text_status PENDING); an EXTRACT job converts it to Markdown."""
    data = await file.read(cases.MAX_UPLOAD_BYTES + 1)
    try:
        artifact = await cases.upload_file(session, user, case_id, file.filename or "upload", data, file_type)
    except (cases.NotFoundError, cases.ConflictError, cases.InvalidError, cases.ForbiddenError) as error:
        raise HTTPException(UPLOAD_ERRORS[type(error)], str(error)) from None
    out = ArtifactRefOut.model_validate(artifact)
    await service.request_extract(session, user, case_id)
    await realtime.room_changed(realtime.thread_room(case_id), "threads")
    return out
