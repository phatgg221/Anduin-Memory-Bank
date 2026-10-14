# Backend Patterns — FastAPI · SQLAlchemy 2.0 (async) · pgvector · MinIO

Table and column names in the SQL below are **illustrative**: the schema isn't decided. Keep the *patterns*; ask before committing to names.

## Layout

```text
backend/
├── pyproject.toml · uv.lock · Dockerfile
├── app/
│   ├── main.py                 # FastAPI app, lifespan, router registration
│   ├── health.py               # GET /api/health
│   ├── core/
│   │   ├── config.py           # pydantic-settings
│   │   └── storage.py          # MinIO: internal client + public signer
│   ├── db/
│   │   ├── base.py             # DeclarativeBase
│   │   ├── session.py          # async engine, SessionLocal, get_session
│   │   └── schema.py           # init_db() / drop_all() — imports every module's models
│   ├── modules/
│   │   ├── vault/              # router, service, models, schemas, ingest (chunk + embed)
│   │   ├── triage/             # router, service, models, schemas, worker, sweeper
│   │   └── intelligence/       # service, retrieval, llm_client, prompts, schemas, guard
│   └── seed.py
└── tests/
```

## Module rules

| File | Responsibility | Never |
|---|---|---|
| `router.py` | `APIRouter(prefix="/<domain>")`; parse input, call the service, map domain errors to HTTP | SQL, business logic |
| `service.py` | Business logic; takes `AsyncSession` first; owns the transaction | Return `Response` objects; import routers |
| `models.py` | SQLAlchemy models | Change without asking (schema TBD) |
| `schemas.py` | Pydantic request/response models | Leak ORM objects to the client |

- **Dependency direction:** `triage → intelligence → vault → core/db`. Cross-module calls go through `service.py` only.
- **Table ownership:** only the owning module writes its tables.

## `core/config.py`

```python
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Values come from the environment: docker-compose.yml + the root .env (via env_file).
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str

    minio_endpoint: str = "minio:9000"
    minio_public_endpoint: str = "localhost:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "memory-bank"
    minio_secure: bool = False
    presign_ttl_seconds: int = 600

    llm_provider: Literal["gemini", "openrouter", "fake"] = "fake"
    llm_model: str = ""
    embedding_provider: Literal["gemini", "fake"] = "fake"
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None

    job_max_attempts: int = 3
    job_stale_after_seconds: int = 120
    sweeper_interval_seconds: int = 30
    worker_poll_interval_seconds: float = 1.0
    worker_concurrency: int = 2


settings = Settings()
```

## `db/session.py`

```python
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)  # postgresql+asyncpg://
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
```

## `db/schema.py`

```python
from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine

# create_all only knows about models that have been imported.
from app.modules.triage import models as _triage_models  # noqa: F401
from app.modules.vault import models as _vault_models  # noqa: F401


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)


async def drop_all() -> None:
    """Used by `bun run dev --refresh-db`. create_all never alters existing tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
```

Vector columns use `pgvector.sqlalchemy.Vector(settings.embedding_dim)`. If you add an ANN index, build it with `vector_cosine_ops` so it serves `cosine_distance` (`<=>`). HNSW on `vector` supports at most 2,000 dimensions.

## `main.py` (target shape once the worker exists)

```python
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.storage import ensure_bucket
from app.db.schema import init_db
from app.db.session import engine
from app.health import router as health_router
from app.modules.triage.router import router as triage_router
from app.modules.triage.sweeper import run_sweeper, sweep_once
from app.modules.triage.worker import run_worker
from app.modules.vault.router import router as vault_router

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Idempotent: safe on every container start.
    await init_db()  # fatal: no database, no app
    try:
        await asyncio.to_thread(ensure_bucket)
    except Exception as exc:
        # Non-fatal. A startup crash under `uvicorn --reload` leaves the reloader holding the port, so
        # requests hang instead of failing. /api/health reports the outage instead.
        logger.warning("MinIO unavailable at startup, bucket not ensured: %s", exc)
    await sweep_once()  # recover jobs orphaned by a restart
    tasks = [asyncio.create_task(run_worker()), asyncio.create_task(run_sweeper())]
    yield
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await engine.dispose()


app = FastAPI(
    title="Anduin Memory Bank",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.include_router(health_router, prefix="/api")
app.include_router(vault_router, prefix="/api")
app.include_router(triage_router, prefix="/api")
```

`app/health.py` already exists. It returns `200 {status, database, pgvector, storage}` or `503` when degraded, and the frontend status panel depends on that shape.

## Router → service

```python
# modules/triage/router.py
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.modules.triage import service
from app.modules.triage.schemas import CreateTriageResponse, TriageJobOut

router = APIRouter(prefix="/triage", tags=["triage"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_triage(
    session: SessionDep,
    text: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> CreateTriageResponse:
    if not text and not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provide text or at least one file")
    job_id = await service.create_job(session, text=text, files=files or [])
    return CreateTriageResponse(job_id=job_id)


@router.get("/{job_id}")
async def get_triage(job_id: str, session: SessionDep) -> TriageJobOut:
    job = await service.get_job(session, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job
```

Multipart forms use the `python-multipart` dependency (already installed).

## Tests

- **Running:** `bun run test [pytest args]` runs `pytest` inside the backend container against the real Postgres and MinIO.
- **App tests:** use `with TestClient(app) as client:` so the lifespan runs. Starlette's TestClient uses `httpx2` (installed); plain `httpx` is deprecated there.
- **Pure-logic tests** (guard, prompt builders, scoring) need no services. Keep them free of DB fixtures.

## Job worker (`modules/triage/worker.py`)

```python
CLAIM_SQL = text("""
    UPDATE triage_jobs
       SET status = 'PROCESSING', attempts = attempts + 1, heartbeat_at = now()
     WHERE id = (SELECT id FROM triage_jobs
                  WHERE status = 'QUEUED'
                  ORDER BY created_at
                  LIMIT 1
                  FOR UPDATE SKIP LOCKED)
 RETURNING id
""")  # names illustrative — schema TBD


async def run_worker() -> None:
    while True:
        job_id = await service.claim_next_job()  # executes CLAIM_SQL in its own transaction
        if job_id is None:
            await asyncio.sleep(settings.worker_poll_interval_seconds)
            continue
        try:
            intake = await service.load_intake(job_id)
            report = await intelligence_service.run_pipeline(
                intake,
                on_step=lambda step: service.heartbeat(job_id, step=step),
            )
            await service.complete(job_id, report)
        except asyncio.CancelledError:
            raise  # shutdown: job stays PROCESSING; the sweeper recovers it after restart
        except Exception as exc:
            await service.record_failure(job_id, exc)  # requeue if attempts remain, else FAILED
```

- **Concurrency:** to process more than one job at a time, run `settings.worker_concurrency` copies of this loop. `SKIP LOCKED` keeps them, and multiple uvicorn processes, from double-claiming.
- **Ownership:** the pipeline lives in `intelligence` but never writes job rows. It reports progress through `on_step`, and `triage` persists everything.

## Sweeper (`modules/triage/sweeper.py`)

```python
async def sweep_once() -> None:
    """PROCESSING jobs with a stale heartbeat → QUEUED (attempts left) or FAILED."""
    cutoff = datetime.now(UTC) - timedelta(seconds=settings.job_stale_after_seconds)
    async with SessionLocal.begin() as session:
        await session.execute(
            text("""
                UPDATE triage_jobs
                   SET status = CASE WHEN attempts >= :max THEN 'FAILED' ELSE 'QUEUED' END,
                       error  = CASE WHEN attempts >= :max
                                     THEN 'Gave up after repeated stalls' ELSE error END
                 WHERE status = 'PROCESSING' AND heartbeat_at < :cutoff
            """),
            {"max": settings.job_max_attempts, "cutoff": cutoff},
        )


async def run_sweeper() -> None:
    while True:
        await asyncio.sleep(settings.sweeper_interval_seconds)
        await sweep_once()
```

The cutoff is computed in Python on purpose: it avoids asyncpg type-inference problems with interval math on bind parameters.

## MinIO (`core/storage.py` — already implemented, reuse it)

| Client | Endpoint | Use |
|---|---|---|
| `internal` | `minio:9000` | All server-side reads/writes. It blocks, so wrap calls in `asyncio.to_thread`. Retries with backoff (~6 s to fail when MinIO is down) |
| `_probe` | `minio:9000` | Health checks only. No retries, 1 s connect / 2 s read timeout |
| `public_signer` | `localhost:${MINIO_API_PORT}` | `presigned_get(key, filename, disposition)`. SigV4 signs the Host header, so it must be the browser's host |

- **Fixed region:** all three clients use `region="us-east-1"`, which skips the SDK's bucket-location lookup. That's what keeps signing network-free.
- **Tests:** `tests/test_storage.py` asserts URLs are signed for the public host.
- **Verified end to end:** an object uploaded via `internal` downloads from the host through a presigned URL.
- **Blocking calls:** `put_object`, `get_object`, `bucket_exists`, and other network calls block, so call them via `await asyncio.to_thread(...)` from async code.
- **Object keys:** `cases/{case_slug}/artifacts/{filename}` and `intake/{job_id}/{filename}`.
