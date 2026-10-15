import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.core.db import engine
from app.core.storage import ensure_bucket
from app.health import router as health_router
from app.modules.auth.router import router as auth_router
from app.modules.cases.router import router as cases_router
from app.modules.org.router import router as org_router
from app.modules.rooms.router import router as rooms_router
from app.modules.triage.router import memory_router
from app.modules.triage.router import router as triage_router
from app.modules.triage.service import sweep_once
from app.modules.triage.worker import run_sweeper, run_worker
from app.modules.vault.router import router as vault_router

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Idempotent: safe on every container start. The schema is not created here: Alembic owns it, and the
    # container runs `alembic upgrade head` before uvicorn starts (Dockerfile CMD).
    try:
        await asyncio.to_thread(ensure_bucket)
    except Exception as exc:
        # Storage outages shouldn't take the API down: /api/health reports them, and the next start retries.
        logger.warning("MinIO unavailable at startup, bucket not ensured: %s", exc)
    tasks: list[asyncio.Task] = []
    if settings.worker_enabled:
        await sweep_once()  # recover jobs orphaned by a restart
        tasks = [asyncio.create_task(run_worker()), asyncio.create_task(run_sweeper())]
    yield
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await engine.dispose()


app = FastAPI(
    title="Dejavu API",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(cases_router, prefix="/api")
app.include_router(org_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(triage_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(vault_router, prefix="/api")
