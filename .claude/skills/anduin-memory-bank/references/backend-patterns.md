# Backend Patterns — FastAPI · SQLAlchemy 2.0 (async) · Alembic · pgvector · MinIO

Domain table and column names below (`triage_jobs`, …) are **illustrative**: the domain schema isn't decided. Keep the *patterns*; ask before committing to names. The auth tables (`users`, `refresh_tokens`) are real.

## Layout

```text
backend/
├── pyproject.toml · uv.lock · Dockerfile     # [tool.alembic] config lives in pyproject.toml
├── migrations/
│   ├── env.py                  # async engine, URL from settings, imports every module's models
│   ├── script.py.mako          # template for new revisions
│   └── versions/               # one file per schema change: YYYYMMDD_HHMM_<rev>_<slug>.py
├── app/
│   ├── main.py                 # FastAPI app, lifespan, router registration
│   ├── health.py               # GET /api/health
│   ├── core/                   # shared infrastructure — no domain logic
│   │   ├── config.py           # pydantic-settings
│   │   ├── db.py               # Base (+ naming convention), engine, SessionLocal, get_session, SessionDep
│   │   ├── security.py         # Argon2id hash/verify, JWT create/decode
│   │   ├── storage.py          # MinIO: internal client, no-retry probe, public signer
│   │   └── migrations.py       # Alembic from code: reset() (dev/test), upgrade_to_head()
│   ├── modules/
│   │   ├── auth/               # models, schemas, service, router, deps (CurrentUser)
│   │   ├── vault/              # router, service, models, schemas, ingest (chunk + embed)
│   │   ├── triage/             # router, service, models, schemas, worker, sweeper
│   │   └── intelligence/       # service, retrieval, llm_client, prompts, schemas, guard
│   └── seed.py
└── tests/                      # conftest builds memory_bank_test from the migrations
```

## Module rules

| File | Responsibility | Never |
|---|---|---|
| `router.py` | `APIRouter(prefix="/<domain>")`; parse input, call the service, map domain errors to HTTP | SQL, business logic |
| `service.py` | Business logic; takes `AsyncSession` first; owns the transaction | Return `Response` objects; import routers |
| `models.py` | SQLAlchemy models (import `Base` from `app.core.db`) | Change without a migration; invent domain tables without asking |
| `schemas.py` | Pydantic request/response models | Leak ORM objects to the client |

- **Dependency direction:** `triage → intelligence → vault → core`. Any module may depend on `auth.deps` (`CurrentUser`). Cross-module calls go through `service.py` only.
- **Table ownership:** only the owning module writes its tables.

## Schema changes — Alembic

1. Edit or add `models.py`. For a **new module**, also add `from app.modules.<name> import models as _<name>_models  # noqa: F401` to `migrations/env.py`.
2. `bun run db:revision "add triage jobs"` autogenerates `migrations/versions/<date>_<rev>_add_triage_jobs.py`, already formatted by ruff.
3. **Read the file.** Fix anything autogenerate can't infer:
   - **Renames:** it emits drop + add. Use `op.alter_column(..., new_column_name=...)` / `op.rename_table` instead.
   - **Extensions / SQL functions / data backfills:** hand-write them with `op.execute(...)`.
   - **New NOT NULL columns on tables with rows:** add a `server_default`, or add the column nullable → backfill → `alter_column(nullable=False)`.
   - **pgvector columns:** the rendered type is `pgvector.sqlalchemy.vector.VECTOR(dim=…)`. Make sure the file imports `pgvector.sqlalchemy`.
4. `bun run db:migrate`, then `bun run test`. `test_migrations.py` fails if the models and migrations differ, and checks downgrade/upgrade.
5. Commit the model change and the migration together.

- **Blank migration:** `bun run db:revision "…" --empty`.
- **Roll back:** `bun run db:downgrade`.
- **Start over locally:** `bun run db:reset`.
- **Never use `Base.metadata.create_all`.** The container runs `alembic upgrade head` before uvicorn.

## `core/config.py` (excerpt)

```python
class Settings(BaseSettings):
    # Values come from the environment: docker-compose.yml + the root .env (via env_file).
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str
    minio_endpoint: str = "minio:9000"
    minio_public_endpoint: str = "localhost:9000"
    # … minio, llm, embedding settings …
    jwt_secret: str = Field(min_length=32)          # generated into .env by bun run setup/dev
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    refresh_reuse_grace_seconds: int = 30
    refresh_cookie_secure: bool = False

    # Added with the job worker:
    # job_max_attempts: int = 3; job_stale_after_seconds: int = 120; sweeper_interval_seconds: int = 30
    # worker_poll_interval_seconds: float = 1.0; worker_concurrency: int = 2


settings = Settings()
```

## `core/db.py`

```python
NAMING_CONVENTION = {"ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s",
                     "ck": "ck_%(table_name)s_%(constraint_name)s",
                     "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s", "pk": "pk_%(table_name)s"}

class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

engine = create_async_engine(settings.database_url, pool_pre_ping=True)  # postgresql+asyncpg://
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

SessionDep = Annotated[AsyncSession, Depends(get_session)]
```

Vector columns use `pgvector.sqlalchemy.Vector(settings.embedding_dim)`. If you add an ANN index, build it with `vector_cosine_ops` so it serves `cosine_distance` (`<=>`). HNSW on `vector` supports at most 2,000 dimensions.

## Protecting routes — `auth.deps.CurrentUser`

```python
from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser

@router.get("/cases")
async def list_cases(user: CurrentUser, session: SessionDep) -> list[CaseOut]:
    ...  # 401 with WWW-Authenticate: Bearer if the access token is missing/invalid/expired
```

- `CurrentUser` verifies the JWT (type `access`) and loads an active `User`.
- **Default to protecting every new domain route.** Only `/api/health` and `/api/auth/*` are public.
- **Never put tokens in URLs or logs.** The refresh token only ever travels in the httpOnly `dejavu_refresh` cookie (`Path=/`, `SameSite=Lax`). The Next.js proxy verifies it with the same `JWT_SECRET`, so keep the cookie name and claims (`sub`, `type`, `jti`, `exp`) stable, or update `frontend/lib/sessionCookie.ts` to match.
- **Auth internals:**
  - `core/security.py` holds `hash_password` / `verify_password`, which are CPU-bound, so call them via `asyncio.to_thread`, plus `create_token` / `decode_token`.
  - `modules/auth/service.py` handles rotation, reuse detection, and family revocation.

## `main.py` (target shape once the worker exists)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # The schema is NOT created here: the container runs `alembic upgrade head` before uvicorn.
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


app = FastAPI(title="Dejavu API", lifespan=lifespan, docs_url="/api/docs", redoc_url=None,
              openapi_url="/api/openapi.json")
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(vault_router, prefix="/api")
app.include_router(triage_router, prefix="/api")
```

`app/health.py` already exists. It returns `200 {status, database, pgvector, storage}` or `503` when degraded, and the frontend status bar depends on that shape.

## Router → service

```python
# modules/triage/router.py
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser
from app.modules.triage import service
from app.modules.triage.schemas import CreateTriageResponse, TriageJobOut

router = APIRouter(prefix="/triage", tags=["triage"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_triage(
    user: CurrentUser,
    session: SessionDep,
    text: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> CreateTriageResponse:
    if not text and not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provide text or at least one file")
    job_id = await service.create_job(session, user_id=user.id, text=text, files=files or [])
    return CreateTriageResponse(job_id=job_id)


@router.get("/{job_id}")
async def get_triage(job_id: str, user: CurrentUser, session: SessionDep) -> TriageJobOut:
    job = await service.get_job(session, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job
```

Multipart forms use the `python-multipart` dependency (already installed).

## Serving views without N+1 (backend half of the UI rule)

The frontend loads a screen in a fixed number of requests (frontend-patterns § Data loading). So the API provides **view-shaped endpoints**: one response per screen/pane, containing every field the UI renders, built with a **fixed number of SQL queries** no matter how many rows.

```python
# models.py — make accidental lazy loads impossible (async would raise MissingGreenlet anyway; this fails clearly)
class HistoricalCase(Base):
    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="case", lazy="raise")
    author: Mapped["Person"] = relationship(lazy="raise")

# service.py — load what the view needs, explicitly
async def list_cases(session: AsyncSession) -> list[HistoricalCase]:
    stmt = (
        select(HistoricalCase)
        .options(selectinload(HistoricalCase.artifacts), joinedload(HistoricalCase.author))  # 2–3 queries total
        .order_by(HistoricalCase.created_at.desc())
    )
    return list((await session.scalars(stmt)).unique())

# Counts/aggregates in SQL, never len(case.artifacts) over a loop of loads
artifact_counts = select(Artifact.case_id, func.count()).group_by(Artifact.case_id)
```

| Never | Instead |
|---|---|
| `await session.get(...)` / a query inside a `for` loop | One `select … where id in (…)` (or `selectinload`) and a dict lookup |
| Client calling `GET /items/{id}` N times | A batch endpoint: `ids: Annotated[list[uuid.UUID], Query(max_length=100)]` → `where(Model.id.in_(ids))` |
| A detail endpoint the list page needs per row | Put those fields in the list response (a lean `…ListItem` schema) |
| Python-side counting/filtering of loaded rows | `func.count`, `group by`, `where`, `exists` in SQL |

### Writes that make optimistic UI safe

- **Return the updated resource** (or the created one), so the client reconciles without a refetch.
- **Idempotent by design**, because the client retries transient failures:
  - `PUT`/`PATCH` carry explicit target state (`{"selected": true}`), not toggles.
  - `DELETE` returns 204 even if the row is already gone.
  - Creates accept a client-generated `id` (UUID) and dedupe on it (`INSERT … ON CONFLICT (id) DO NOTHING`, then return the existing row).
- **Status codes drive the client's retry:** 4xx means retrying won't help (validation 422, conflict 409, not found 404), and the UI rolls back. 5xx is reserved for transient or server faults, and the client retries.

### Test it: constant query count

```python
# tests/conftest.py — add with the first view endpoint
from contextlib import contextmanager
from sqlalchemy import event
from app.core.db import engine

@contextmanager
def count_queries():
    statements: list[str] = []
    def record(conn, cursor, statement, *args):
        statements.append(statement)
    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)

# tests/test_vault.py
def test_case_list_query_count_does_not_grow_with_rows(client, auth_headers, make_cases):
    make_cases(2)
    with count_queries() as few:
        client.get("/api/vault/cases", headers=auth_headers)
    make_cases(20)
    with count_queries() as many:
        client.get("/api/vault/cases", headers=auth_headers)
    assert len(many) == len(few)
```

## Tests

- **Running:** `bun run test [pytest args]` runs `pytest` inside the backend container against the real Postgres and MinIO.
- **Isolation:** `tests/conftest.py` points `DATABASE_URL` at `memory_bank_test`, rebuilds it from the migrations once per run, and truncates every table (except `alembic_version`) before each test that uses the `client` fixture.
- **App tests:** take the `client` fixture (a `TestClient` with the lifespan running). Starlette's TestClient uses `httpx2` (installed); plain `httpx` is deprecated there.
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
