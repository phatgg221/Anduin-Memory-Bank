import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.db import engine
from app.core.storage import ensure_bucket
from app.health import router as health_router
from app.modules.auth.router import router as auth_router
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
    # TODO(schema): once the triage job table exists, run sweep_once() here and start the worker and
    # sweeper loops (see .claude/skills/anduin-memory-bank/references/backend-patterns.md).
    yield
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
app.include_router(vault_router, prefix="/api")
