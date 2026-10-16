import uuid
from datetime import UTC, datetime

from tests.test_auth import bearer, register
from tests.test_rooms import SETUP

APOLLO = "00000000-0000-0000-0000-000000000047"
SOVEREIGN = "00000000-0000-0000-0000-000000000052"


# Case channels are members-only: Elena and Ryan are on both seeded cases in these tests.
CASE_MEMBERS = """
INSERT INTO case_members (case_id, user_id, role)
  SELECT c.id, u.id, 'MEMBER' FROM case_records c, users u
  WHERE c.case_code IN ('CASE-2026-047', 'CASE-2025-052')
    AND u.email IN ('elena@anduin.example', 'ryan@anduin.example');
"""


def signed_in(client, sql):
    elena = bearer(register(client, email="elena@anduin.example", name="Elena Rostova").json()["access_token"])
    ryan = bearer(register(client, email="ryan@anduin.example", name="Ryan Miller").json()["access_token"])
    sql("INSERT INTO departments (id, code, name) VALUES ('CLIENT_OPERATIONS', 'OPS', 'Client Operations')")
    sql(SETUP)
    sql(CASE_MEMBERS)
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
        "client_name": "Bain Capital",
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


def new_case(client, headers, **overrides):
    body = {
        "id": str(uuid.uuid4()),
        "client_name": "Bain Capital",
        "title": "Bain Capital Tech Opportunities V — Parallel Fund Onboarding",
        "initial_request_brief": "Bain needs a Delaware parallel fund with ERISA tracking.",
        "severity": "HIGH",
        "due_date": "2026-12-01",
        "context_tags": {"Jurisdiction": "Delaware", "Fund Structure": "Parallel Fund"},
        "department_id": "LEGAL_COMPLIANCE",
        **overrides,
    }
    return client.post("/api/cases", json=body, headers=headers)


def test_intake_fields_are_stored_and_shown_in_the_thread(client, sql):
    elena, ryan = signed_in(client, sql)
    created = new_case(client, elena)
    assert created.status_code == 201
    summary = created.json()
    assert (summary["client_name"], summary["severity"], summary["due_date"]) == ("Bain Capital", "HIGH", "2026-12-01")

    view = client.get(f"/api/cases/{summary['id']}/thread", headers=ryan).json()
    assert view["lead"]["name"] == "Elena Rostova"  # owner defaults to the creator
    assert view["context_tags"] == {"Jurisdiction": "Delaware", "Fund Structure": "Parallel Fund"}
    assert view["artifacts"] == []

    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]
    owned = new_case(client, elena, lead_user_id=ryan_id).json()
    assert client.get(f"/api/cases/{owned['id']}/thread", headers=elena).json()["lead"]["name"] == "Ryan Miller"


def test_intake_validation(client, sql):
    elena, _ = signed_in(client, sql)
    assert new_case(client, elena, severity="URGENT").status_code == 422
    assert new_case(client, elena, client_name="").status_code == 422
    assert new_case(client, elena, context_tags={f"Tag {i}": "x" for i in range(9)}).status_code == 422
    alumni = new_case(client, elena, lead_user_id="00000000-0000-0000-0000-0000000000d1")  # David Le, inactive
    assert alumni.status_code == 422


def test_edit_case_details(client, sql, monkeypatch):
    from app.core import realtime

    published = []

    async def capture(room_id, event):
        published.append(room_id)

    monkeypatch.setattr(realtime, "publish", capture)
    elena, ryan = signed_in(client, sql)
    patch = {"severity": "CRITICAL", "due_date": None, "secondary_department_ids": ["SALES_SOLUTIONS"]}
    edited = client.patch(f"/api/cases/{APOLLO}", json=patch, headers=ryan)
    assert edited.status_code == 200
    view = edited.json()
    assert view["severity"] == "CRITICAL" and view["due_date"] is None
    assert view["secondary_department_ids"] == ["SALES_SOLUTIONS"]
    assert view["initial_request_brief"] == "Apollo brief"  # untouched fields stay
    assert {f"case-{APOLLO}", "CLIENT_OPERATIONS", "LEGAL_COMPLIANCE", "SALES_SOLUTIONS"} <= set(published)

    sales = client.get("/api/rooms/SALES_SOLUTIONS", headers=ryan).json()["threads"]
    assert [t["case_code"] for t in sales] == ["CASE-2026-047"]
    assert client.patch(f"/api/cases/{APOLLO}", json={"severity": "NOPE"}, headers=ryan).status_code == 422
    assert client.patch(f"/api/cases/{SOVEREIGN}", json={"severity": "LOW"}, headers=ryan).status_code == 409


def member_roles(client, headers, case_id):
    view = client.get(f"/api/cases/{case_id}/thread", headers=headers).json()
    return {m["user"]["name"]: m["role"] for m in view["members"]}


def test_case_members(client, sql):
    elena, ryan = signed_in(client, sql)
    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]
    case_id = new_case(client, elena, lead_user_id=ryan_id).json()["id"]
    assert member_roles(client, elena, case_id) == {"Ryan Miller": "LEAD", "Elena Rostova": "MEMBER"}

    url = f"/api/cases/{APOLLO}/members/{ryan_id}"
    assert member_roles(client, elena, APOLLO) == {"Elena Rostova": "MEMBER", "Ryan Miller": "MEMBER"}
    assert client.delete(url, headers=elena).status_code == 204
    assert client.delete(url, headers=elena).status_code == 204  # already gone is fine
    assert member_roles(client, elena, APOLLO) == {"Elena Rostova": "MEMBER"}
    assert client.put(url, headers=ryan).status_code == 403  # a non-member can't add anyone, themselves included
    assert client.put(url, headers=elena).status_code == 204
    assert client.put(url, headers=elena).status_code == 204  # idempotent
    assert member_roles(client, elena, APOLLO) == {"Elena Rostova": "MEMBER", "Ryan Miller": "MEMBER"}

    alumni = "00000000-0000-0000-0000-0000000000d1"
    assert client.put(f"/api/cases/{APOLLO}/members/{alumni}", headers=elena).status_code == 422
    assert client.put(f"/api/cases/{APOLLO}/members/{uuid.uuid4()}", headers=elena).status_code == 404
    assert client.delete(f"/api/cases/{case_id}/members/{ryan_id}", headers=elena).status_code == 409  # the owner
    assert client.put(f"/api/cases/{SOVEREIGN}/members/{ryan_id}", headers=elena).status_code == 409  # resolved

    elena_id = client.get("/api/auth/me", headers=elena).json()["id"]
    client.patch(f"/api/cases/{case_id}", json={"lead_user_id": elena_id}, headers=elena)
    assert member_roles(client, elena, case_id) == {"Elena Rostova": "LEAD", "Ryan Miller": "MEMBER"}


def test_create_case_with_people_to_resolve_it(client, sql):
    elena, ryan = signed_in(client, sql)
    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]
    case_id = new_case(client, elena, member_ids=[ryan_id, ryan_id]).json()["id"]
    assert member_roles(client, elena, case_id) == {"Elena Rostova": "LEAD", "Ryan Miller": "MEMBER"}

    alumni = "00000000-0000-0000-0000-0000000000d1"
    assert new_case(client, elena, member_ids=[alumni]).status_code == 422
    assert new_case(client, elena, member_ids=[str(uuid.uuid4())]).status_code == 422


def test_case_channels_are_members_only(client, sql):
    from tests.test_auth import bearer, register

    elena, ryan = signed_in(client, sql)
    sarah = bearer(register(client, email="sarah@anduin.example", name="Sarah Tran").json()["access_token"])
    post(client, elena, APOLLO, "Members-only kickoff")
    base = f"/api/cases/{APOLLO}"

    view = client.get(f"{base}/thread", headers=sarah).json()
    assert view["is_member"] is False and view["messages"] == [] and view["participants"] == []
    assert view["initial_request_brief"] == "Apollo brief" and view["members"]  # case info stays visible
    assert post(client, sarah, APOLLO, "hello").status_code == 403
    assert client.get(f"{base}/thread/messages", headers=sarah).status_code == 403
    assert client.patch(base, json={"severity": "LOW"}, headers=sarah).status_code == 403
    assert client.get(f"{base}/copilot", headers=sarah).status_code == 403
    ask = {"message_id": str(uuid.uuid4()), "job_id": str(uuid.uuid4()), "question": "What happened here?"}
    assert client.post(f"{base}/copilot", json=ask, headers=sarah).status_code == 403
    assert client.post(f"{base}/analyze", json={"job_id": str(uuid.uuid4())}, headers=sarah).status_code == 403
    assert client.post(f"{base}/resolve", json={"job_id": str(uuid.uuid4())}, headers=sarah).status_code == 403
    files = {"file": ("note.txt", b"hello there", "text/plain")}
    assert client.post(f"{base}/files", files=files, headers=sarah).status_code == 403
    assert client.post("/api/rooms/tickets", json={"room": f"case-{APOLLO}"}, headers=sarah).status_code == 403
    summaries = {c["case_code"]: c for c in client.get("/api/cases", headers=sarah).json()}
    assert summaries["CASE-2026-047"]["is_member"] is False

    request = client.post(f"{base}/access-requests", headers=sarah).json()
    assert client.get(f"{base}/thread", headers=sarah).json()["my_access_request"]["status"] == "PENDING"
    [pending] = client.get(f"{base}/thread", headers=elena).json()["access_requests"]
    assert pending["id"] == request["id"] and pending["user"]["name"] == "Sarah Tran"
    assert (
        client.put(f"{base}/access-requests/{pending['id']}", json={"approve": True}, headers=elena).status_code == 204
    )

    after = client.get(f"{base}/thread", headers=sarah).json()
    assert after["is_member"] is True and [m["content"] for m in after["messages"]] == ["Members-only kickoff"]
    assert post(client, sarah, APOLLO, "Thanks for adding me").status_code == 200
    assert client.post("/api/rooms/tickets", json={"room": f"case-{APOLLO}"}, headers=sarah).status_code == 200
