from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_database_pgvector_and_storage():
    with TestClient(app) as client:  # runs the lifespan: extension + bucket bootstrap
        response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] is True
    assert body["pgvector"]
    assert body["storage"] is True
