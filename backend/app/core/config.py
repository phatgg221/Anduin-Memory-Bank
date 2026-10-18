from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Values come from the environment (docker-compose.yml + root .env)."""

    model_config = SettingsConfigDict(extra="ignore")

    database_url: str

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, url: str) -> str:
        # Hosted Postgres (Neon, Supabase) hands out libpq URLs; asyncpg takes `ssl` and rejects libpq-only params.
        parts = urlsplit(url)
        scheme = "postgresql+asyncpg" if parts.scheme in ("postgres", "postgresql") else parts.scheme
        query = [
            ("ssl" if key == "sslmode" else key, value)
            for key, value in parse_qsl(parts.query)
            if key != "channel_binding"
        ]
        return urlunsplit(parts._replace(scheme=scheme, query=urlencode(query)))

    minio_endpoint: str = "minio:9000"
    minio_public_endpoint: str = "localhost:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "memory-bank"
    minio_secure: bool = False
    minio_public_secure: bool = False
    presign_ttl_seconds: int = 600

    llm_provider: Literal["gemini", "openrouter", "fake"] = "fake"
    llm_model: str = ""
    # The triage agent's tool-calling model (OpenRouter id, e.g. google/gemini-2.5-flash); empty = llm_model.
    agent_model: str = ""
    # Reads scanned PDFs and photos (OpenRouter id of a model with native PDF/image input); empty = agent_model.
    ocr_model: str = ""
    embedding_provider: Literal["gemini", "openrouter", "fake"] = "fake"
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_timeout_seconds: float = 60.0

    # Background jobs (case_jobs): worker + sweeper run inside the API process. Tests turn the loops off.
    worker_enabled: bool = True
    worker_poll_interval_seconds: float = 1.0
    job_max_attempts: int = 3
    job_stale_after_seconds: int = 120
    sweeper_interval_seconds: int = 30

    # PartyServer realtime service: the API POSTs persisted war-room events to it. Unset = realtime off (tests).
    realtime_url: str | None = None
    realtime_secret: str = ""

    # HS256 signing key. `bun run setup` / `bun run dev` generate one into .env.
    jwt_secret: str = Field(min_length=32)
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    # Grace period in which reusing a just-rotated refresh token is treated as a benign race (two tabs refreshing
    # at once) rather than theft.
    refresh_reuse_grace_seconds: int = 30
    # Set true whenever the app is served over HTTPS.
    refresh_cookie_secure: bool = False


settings = Settings()
