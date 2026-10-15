"""Tests run against a separate database (`<dev db>_test`), built from the Alembic migrations — never create_all.

DATABASE_URL is rewritten here, before any `app` module is imported (the engine is built at import time).
"""

import asyncio
import os
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
from fastapi.testclient import TestClient

_dev = urlsplit(os.environ.get("DATABASE_URL", "postgresql+asyncpg://memory:memory@localhost:5433/memory_bank"))
TEST_DB = _dev.path.lstrip("/") + "_test"
os.environ["DATABASE_URL"] = urlunsplit(_dev._replace(path=f"/{TEST_DB}"))


def _dsn(database: str) -> str:
    # asyncpg wants a plain postgresql:// URL (no SQLAlchemy driver suffix).
    return urlunsplit(_dev._replace(scheme="postgresql", path=f"/{database}"))


async def _ensure_test_database() -> None:
    conn = await asyncpg.connect(_dsn("postgres"))
    try:
        if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", TEST_DB):
            await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()


async def _truncate_all() -> None:
    conn = await asyncpg.connect(_dsn(TEST_DB))
    try:
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
        )
        if rows:
            tables = ", ".join(f'"{row["tablename"]}"' for row in rows)
            await conn.execute(f"TRUNCATE {tables} CASCADE")
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def migrated_database():
    """Fresh schema per test run, built by applying every migration (also proves they apply cleanly)."""
    from app.core.migrations import reset

    asyncio.run(_ensure_test_database())
    reset()


@pytest.fixture
def client(migrated_database):
    from app.main import app

    asyncio.run(_truncate_all())
    with TestClient(app) as test_client:  # runs the lifespan (bucket bootstrap)
        yield test_client


async def _execute(statement: str, *args) -> None:
    conn = await asyncpg.connect(_dsn(TEST_DB))
    try:
        await conn.execute(statement, *args)
    finally:
        await conn.close()


@pytest.fixture
def sql(client):
    """Run raw SQL against the test database (after the client fixture has truncated it)."""
    return lambda statement, *args: asyncio.run(_execute(statement, *args))
