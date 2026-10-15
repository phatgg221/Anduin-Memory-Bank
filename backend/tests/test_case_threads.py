import uuid
from datetime import UTC, datetime

from tests.test_auth import bearer, register
from tests.test_rooms import SETUP

APOLLO = "00000000-0000-0000-0000-000000000047"
SOVEREIGN = "00000000-0000-0000-0000-000000000052"


def signed_in(client, sql):
    elena = bearer(register(client, email="elena@anduin.example", name="Elena Rostova").json()["access_token"])
    ryan = bearer(register(client, email="ryan@anduin.example", name="Ryan Miller").json()["access_token"])
    sql("INSERT INTO departments (id, code, name) VALUES ('CLIENT_OPERATIONS', 'OPS', 'Client Operations')")
    sql(SETUP)
    return elena, ryan


def post(client, headers, case_id, content, message_id=None):
    body = {"id": str(message_id or uuid.uuid4()), "content": content}
    return client.post(f"/api/cases/{case_id}/thread/messages", json=body, headers=headers)


def test_thread_appears_under_every_involved_department(client, sql):
    elena, _ = signed_in(client, sql)
    post(client, elena, APOLLO, "Kickoff notes")
    legal = client.get("/api/rooms/LEGAL_COMPLIANCE", headers=elena).json()["threads"]
    ops = client.get("/api/rooms/CLIENT_OPERATIONS", headers=elena).json()["threads"]
    assert [(t["case_code"], t["message_count"]) for t in legal] == [("CASE-2026-047", 1)]
    assert [t["case_code"] for t in ops] == ["CASE-2026-047"]  # owning department
    assert client.get("/api/rooms/SALES_SOLUTIONS", headers=elena).json()["threads"] == []


def test_thread_view_messages_and_idempotent_posting(client, sql):
    elena, ryan = signed_in(client, sql)
    message_id = uuid.uuid4()
    first = post(client, ryan, APOLLO, "Reuse #CASE-2025-052 language", message_id)
    again = post(client, ryan, APOLLO, "Reuse #CASE-2025-052 language", message_id)
    assert first.status_code == again.status_code == 200
    assert first.json()["seq"] == again.json()["seq"]
    assert first.json()["tagged_case_codes"] == ["CASE-2025-052"]
    assert post(client, elena, APOLLO, "hijack", message_id).status_code == 409

    view = client.get(f"/api/cases/{APOLLO}/thread", headers=elena).json()
    assert view["case_code"] == "CASE-2026-047" and view["initial_request_brief"] == "Apollo brief"
    assert [m["content"] for m in view["messages"]] == ["Reuse #CASE-2025-052 language"]
    assert [p["name"] for p in view["participants"]] == ["Ryan Miller"]
    assert view["precedents"][0]["lead_is_alumni"] is True

    second = post(client, elena, APOLLO, "Agreed").json()
    newer = client.get(f"/api/cases/{APOLLO}/thread/messages", params={"after_seq": first.json()["seq"]}, headers=ryan)
    assert [m["id"] for m in newer.json()] == [second["id"]]


def test_resolved_case_threads_are_read_only(client, sql):
    elena, _ = signed_in(client, sql)
    assert post(client, elena, SOVEREIGN, "late note").status_code == 409
    assert client.get(f"/api/cases/{uuid.uuid4()}/thread", headers=elena).status_code == 404


def test_create_case_assigns_next_code_and_is_idempotent(client, sql):
    elena, ryan = signed_in(client, sql)
    body = {
        "id": str(uuid.uuid4()),
        "title": "Bain Capital Tech Opportunities V — Parallel Fund Onboarding",
        "initial_request_brief": "Bain needs a Delaware parallel fund with ERISA tracking.",
        "department_id": "LEGAL_COMPLIANCE",
        "secondary_department_ids": ["SALES_SOLUTIONS", "LEGAL_COMPLIANCE"],
    }
    created = client.post("/api/cases", json=body, headers=elena)
    assert created.status_code == 201
    code = created.json()["case_code"]
    year = datetime.now(UTC).year
    assert code == f"CASE-{year}-{'048' if year == 2026 else '001'}"  # next number after CASE-2026-047
    assert created.json()["secondary_department_ids"] == ["SALES_SOLUTIONS"]
    assert client.post("/api/cases", json=body, headers=elena).json()["case_code"] == code  # retry: same case
    assert client.post("/api/cases", json=body, headers=ryan).status_code == 409

    sales = client.get("/api/rooms/SALES_SOLUTIONS", headers=elena).json()["threads"]
    assert [t["case_code"] for t in sales] == [code]

    bad = client.post("/api/cases", json={**body, "id": str(uuid.uuid4()), "department_id": "NOPE"}, headers=elena)
    assert bad.status_code == 422


def test_thread_writes_publish_to_thread_and_department_rooms(client, sql, monkeypatch):
    from app.core import realtime

    published = []

    async def capture(room_id, event):
        published.append((room_id, event["type"], event.get("reason")))

    monkeypatch.setattr(realtime, "publish", capture)
    elena, _ = signed_in(client, sql)
    post(client, elena, APOLLO, "Live thread")
    assert published == [
        (f"case-{APOLLO}", "message.created", None),
        ("CLIENT_OPERATIONS", "room.changed", "threads"),
        ("LEGAL_COMPLIANCE", "room.changed", "threads"),
    ]
