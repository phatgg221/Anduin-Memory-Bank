def test_health_reports_database_pgvector_and_storage(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] is True
    assert body["pgvector"]
    assert body["storage"] is True
