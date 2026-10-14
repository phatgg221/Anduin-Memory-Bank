from urllib.parse import parse_qs, urlparse

from app.core.config import settings
from app.core.storage import presigned_get


def test_presigned_url_is_signed_for_the_browser_host():
    url = urlparse(presigned_get("cases/demo/artifacts/schema.json", "schema.json"))

    assert url.netloc == settings.minio_public_endpoint
    assert url.netloc != settings.minio_endpoint
    query = parse_qs(url.query)
    assert query["X-Amz-Expires"] == [str(settings.presign_ttl_seconds)]
    assert query["response-content-disposition"] == ['attachment; filename="schema.json"']
