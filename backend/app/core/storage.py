from datetime import timedelta
from typing import Literal

import urllib3
from minio import Minio

from app.core.config import settings

# MinIO's default region. Fixing it skips the bucket-location lookup the SDK otherwise makes per bucket.
_REGION = "us-east-1"
_credentials = {
    "access_key": settings.minio_access_key,
    "secret_key": settings.minio_secret_key,
    "secure": settings.minio_secure,
    "region": _REGION,
}

# Server-side reads/writes over the Docker network. Its methods block: call them via asyncio.to_thread.
internal = Minio(settings.minio_endpoint, **_credentials)

# Health probe only. The default client retries with backoff (~6 s when MinIO is down), which is right for
# real operations but makes a liveness check hang.
_probe = Minio(
    settings.minio_endpoint,
    **_credentials,
    http_client=urllib3.PoolManager(timeout=urllib3.Timeout(connect=1, read=2), retries=False),
)

# Signs URLs for the browser. SigV4 signs the Host header, so this client must use the host the browser
# will hit. With the region fixed, signing never touches the network (the public host isn't reachable from
# inside the container).
public_signer = Minio(settings.minio_public_endpoint, **{**_credentials, "secure": settings.minio_public_secure})


def ensure_bucket() -> None:
    if not internal.bucket_exists(settings.minio_bucket):
        internal.make_bucket(settings.minio_bucket)


def read_object(key: str) -> bytes:
    """Synchronous (MinIO SDK): call through asyncio.to_thread."""
    response = internal.get_object(settings.minio_bucket, key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def bucket_ready() -> bool:
    try:
        return _probe.bucket_exists(settings.minio_bucket)
    except Exception:
        return False


def presigned_get(key: str, filename: str, disposition: Literal["inline", "attachment"] = "attachment") -> str:
    # Pure computation (no network) because the region is fixed, so it's safe to call from async code.
    return public_signer.presigned_get_object(
        settings.minio_bucket,
        key,
        expires=timedelta(seconds=settings.presign_ttl_seconds),
        response_headers={"response-content-disposition": f'{disposition}; filename="{filename}"'},
    )
