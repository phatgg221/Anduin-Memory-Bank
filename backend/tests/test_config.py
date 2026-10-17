from app.core.config import Settings


def _url(database_url: str) -> str:
    settings = Settings(database_url=database_url, minio_access_key="a", minio_secret_key="b", jwt_secret="x" * 32)
    return settings.database_url


def test_hosted_libpq_url_becomes_asyncpg():
    url = _url("postgresql://user:pw@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")

    assert url == "postgresql+asyncpg://user:pw@ep-x.eu-central-1.aws.neon.tech/neondb?ssl=require"


def test_asyncpg_url_is_left_alone():
    url = "postgresql+asyncpg://memory:memory@postgres:5432/memory_bank"

    assert _url(url) == url
