from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Values come from the environment (docker-compose.yml + root .env)."""

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


settings = Settings()
