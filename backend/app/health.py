import asyncio
from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.core.storage import bucket_ready
from app.db.session import pgvector_version

router = APIRouter(tags=["system"])


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    database: bool
    pgvector: str | None
    storage: bool


@router.get("/health")
async def health(response: Response) -> HealthOut:
    pgvector, storage = await asyncio.gather(pgvector_version(), asyncio.to_thread(bucket_ready))
    database = pgvector is not None
    ok = database and storage
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthOut(status="ok" if ok else "degraded", database=database, pgvector=pgvector, storage=storage)
