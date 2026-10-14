from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def pgvector_version() -> str | None:
    """Installed pgvector version, or None if the database or extension is unavailable."""
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
            return result.scalar_one_or_none()
    except Exception:
        return None
