import uuid

from tests.test_auth import bearer, register

SETUP = """
INSERT INTO departments (id, code, name) VALUES
  ('LEGAL_COMPLIANCE', 'LEGAL', 'Legal & Compliance'),
  ('SALES_SOLUTIONS', 'SALES', 'Sales & Solutions Architecture');
UPDATE departments SET lead_user_id = (SELECT id FROM users WHERE email = 'elena@anduin.example')
  WHERE id = 'LEGAL_COMPLIANCE';
INSERT INTO users (id, email, name, password_hash, avatar_initials, is_active)
  VALUES ('00000000-0000-0000-0000-0000000000d1', 'david@anduin.example', 'David Le', '!', 'DL', false);
INSERT INTO case_records (id, case_code, channel_slug, title, department_id, secondary_department_ids, status,
                          initial_request_brief, resolved_at, comparison_results, lead_resolver_user_id) VALUES
  ('00000000-0000-0000-0000-000000000052', 'CASE-2025-052', 'case-sovereign', 'Sovereign side letter',
   'LEGAL_COMPLIANCE', '[]', 'RESOLVED', 'brief', now(), NULL, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-000000000047', 'CASE-2026-047', 'case-apollo', 'Apollo Crossover Feeder II',
   'CLIENT_OPERATIONS', '["LEGAL_COMPLIANCE"]', 'OPEN', 'Apollo brief', NULL,
   '[{"caseCode": "CASE-2025-052", "similarityScore": 84, "howPastCaseWent": "Four rounds.",
      "pitfallWarnings": [], "deltaItems": []}]', NULL)
"""
ROOM = "/api/rooms/LEGAL_COMPLIANCE"
# Department channels are members-only: Ryan is a member of the Legal channel in these tests.
MEMBERS = """
INSERT INTO rooms (department_id) VALUES ('LEGAL_COMPLIANCE') ON CONFLICT DO NOTHING;
INSERT INTO room_members (department_id, user_id, role)
  SELECT 'LEGAL_COMPLIANCE', id, 'MEMBER' FROM users WHERE email = 'ryan@anduin.example';
"""


def two_users(client, sql):
    elena = bearer(register(client, email="elena@anduin.example", name="Elena Rostova").json()["access_token"])
    ryan = bearer(register(client, email="ryan@anduin.example", name="Ryan Miller").json()["access_token"])
    sql("INSERT INTO departments (id, code, name) VALUES ('CLIENT_OPERATIONS', 'OPS', 'Client Operations')")
    sql(SETUP)
    sql(MEMBERS)
    return elena, ryan


def post(client, headers, content, message_id=None):
    return client.post(
        f"{ROOM}/messages", json={"id": str(message_id or uuid.uuid4()), "content": content}, headers=headers
    )


def test_lead_is_a_member_by_default(client, sql):
    elena, ryan = two_users(client, sql)
    view = client.get(ROOM, headers=ryan).json()
    assert [(m["user"]["name"], m["role"]) for m in view["members"]] == [
        ("Elena Rostova", "LEAD"),
        ("Ryan Miller", "MEMBER"),
    ]
    assert view["is_member"] is True

    rooms = {r["department_id"]: r for r in client.get("/api/rooms", headers=elena).json()}
    assert rooms["LEGAL_COMPLIANCE"]["lead"]["name"] == "Elena Rostova"
    assert rooms["LEGAL_COMPLIANCE"]["is_member"] is True


def test_posting_is_idempotent_tags_known_cases_and_joins(client, sql):
    elena, ryan = two_users(client, sql)
    message_id = uuid.uuid4()
    first = post(client, ryan, "Reuse #CASE-2025-052 for #CASE-2026-047, not #CASE-1999-999", message_id)
    again = post(client, ryan, "Reuse #CASE-2025-052 for #CASE-2026-047, not #CASE-1999-999", message_id)
    assert first.status_code == again.status_code == 200
    assert first.json()["seq"] == again.json()["seq"]
    assert first.json()["tagged_case_codes"] == ["CASE-2025-052", "CASE-2026-047"]

    view = client.get(ROOM, headers=ryan).json()
    assert len(view["messages"]) == 1 and view["is_member"] is True
    assert post(client, elena, "hijack", message_id).status_code == 409


def test_unread_counts_polling_and_read_marker(client, sql):
    elena, ryan = two_users(client, sql)
    seqs = [post(client, ryan, f"update {i}").json()["seq"] for i in range(3)]

    unread = {r["department_id"]: r["unread_count"] for r in client.get("/api/rooms", headers=elena).json()}
    assert unread["LEGAL_COMPLIANCE"] == 3
    assert {r["department_id"]: r["unread_count"] for r in client.get("/api/rooms", headers=ryan).json()}[
        "LEGAL_COMPLIANCE"
    ] == 0  # own messages never count

    newer = client.get(f"{ROOM}/messages", params={"after_seq": seqs[0]}, headers=elena).json()
    assert [m["content"] for m in newer] == ["update 1", "update 2"]

    assert client.put(f"{ROOM}/read", json={"seq": seqs[1]}, headers=elena).status_code == 204
    assert client.put(f"{ROOM}/read", json={"seq": seqs[0]}, headers=elena).status_code == 204  # never moves back
    rooms = {r["department_id"]: r for r in client.get("/api/rooms", headers=elena).json()}
    assert rooms["LEGAL_COMPLIANCE"]["unread_count"] == 1


def test_membership_rules(client, sql):
    elena, ryan = two_users(client, sql)
    view = client.get(ROOM, headers=ryan).json()
    lead_id = view["lead_user_id"]
    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]

    assert client.delete(f"{ROOM}/members/{lead_id}", headers=ryan).status_code == 409
    assert client.put(f"{ROOM}/members/00000000-0000-0000-0000-0000000000d1", headers=elena).status_code == 422
    assert client.put(f"{ROOM}/members/{ryan_id}", headers=elena).status_code == 204
    assert client.put(f"{ROOM}/members/{ryan_id}", headers=elena).status_code == 204  # idempotent
    assert client.delete(f"{ROOM}/members/{ryan_id}", headers=elena).status_code == 204
    assert client.delete(f"{ROOM}/members/{ryan_id}", headers=elena).status_code == 204  # already gone is fine


def test_pinned_case_shows_precedents_with_alumni_leads(client, sql):
    elena, _ = two_users(client, sql)
    view = client.get(ROOM, headers=elena).json()
    assert [c["case_code"] for c in view["case_options"]] == ["CASE-2026-047"]

    pin = client.put(f"{ROOM}/pinned-case", json={"case_id": view["case_options"][0]["id"]}, headers=elena)
    assert pin.status_code == 204
    pinned = client.get(ROOM, headers=elena).json()["pinned_case"]
    assert pinned["case_code"] == "CASE-2026-047"
    assert pinned["precedents"] == [
        {
            "case_code": "CASE-2025-052",
            "title": "Sovereign side letter",
            "similarity_score": 84,
            "how_past_case_went": "Four rounds.",
            "lead_name": "David Le",
            "lead_is_alumni": True,
        }
    ]
    assert client.get("/api/rooms/NOPE", headers=elena).status_code == 404


def test_people_lists_only_active_users(client, sql):
    elena, _ = two_users(client, sql)
    names = [p["name"] for p in client.get("/api/rooms/people", headers=elena).json()]
    assert names == ["Elena Rostova", "Ryan Miller"]


def test_writes_are_published_to_the_department_room(client, sql, monkeypatch):
    from app.core import realtime

    published = []

    async def capture(department_id, event):
        published.append((department_id, event["type"], event.get("reason")))

    monkeypatch.setattr(realtime, "publish", capture)
    elena, ryan = two_users(client, sql)
    message = post(client, ryan, "Live? #CASE-2026-047").json()
    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]
    client.delete(f"{ROOM}/members/{ryan_id}", headers=elena)
    client.put(f"{ROOM}/pinned-case", json={"case_id": None}, headers=elena)

    assert published == [
        ("LEGAL_COMPLIANCE", "message.created", None),
        ("LEGAL_COMPLIANCE", "room.changed", "members"),
        ("LEGAL_COMPLIANCE", "room.changed", "pinned_case"),
    ]
    assert message["tagged_case_codes"] == ["CASE-2026-047"]


def test_department_channels_are_members_only(client, sql):
    elena, ryan = two_users(client, sql)
    sarah = bearer(register(client, email="sarah@anduin.example", name="Sarah Tran").json()["access_token"])
    post(client, ryan, "Members-only discussion")

    view = client.get(ROOM, headers=sarah).json()
    assert view["is_member"] is False and view["messages"] == [] and view["members"]  # who to ask is visible
    assert post(client, sarah, "let me in").status_code == 403
    assert client.get(f"{ROOM}/messages", headers=sarah).status_code == 403
    assert client.put(f"{ROOM}/read", json={"seq": 1}, headers=sarah).status_code == 403
    sarah_id = client.get("/api/auth/me", headers=sarah).json()["id"]
    assert client.put(f"{ROOM}/members/{sarah_id}", headers=sarah).status_code == 403  # no self-join
    rooms = {r["department_id"]: r for r in client.get("/api/rooms", headers=sarah).json()}
    assert rooms["LEGAL_COMPLIANCE"]["is_member"] is False and rooms["LEGAL_COMPLIANCE"]["unread_count"] == 0
    assert client.post("/api/rooms/tickets", json={"room": "LEGAL_COMPLIANCE"}, headers=sarah).status_code == 403

    asked = client.post(f"{ROOM}/access-requests", headers=sarah)
    assert asked.status_code == 201
    assert client.post(f"{ROOM}/access-requests", headers=sarah).json()["id"] == asked.json()["id"]  # idempotent
    assert client.get(ROOM, headers=sarah).json()["my_access_request"]["status"] == "PENDING"
    [pending] = client.get(ROOM, headers=ryan).json()["access_requests"]
    assert pending["user"]["name"] == "Sarah Tran"
    decide = f"{ROOM}/access-requests/{pending['id']}"
    assert client.put(decide, json={"approve": True}, headers=sarah).status_code == 403  # can't approve yourself
    assert client.put(decide, json={"approve": True}, headers=ryan).status_code == 204

    after = client.get(ROOM, headers=sarah).json()
    assert after["is_member"] is True and [m["content"] for m in after["messages"]] == ["Members-only discussion"]
    assert post(client, sarah, "thanks").status_code == 200
    ticket = client.post("/api/rooms/tickets", json={"room": "LEGAL_COMPLIANCE"}, headers=sarah).json()["ticket"]
    import jwt

    from app.core.config import settings

    claims = jwt.decode(ticket, settings.jwt_secret, algorithms=["HS256"])
    assert claims["type"] == "room" and claims["room"] == "LEGAL_COMPLIANCE" and claims["sub"] == sarah_id


def test_department_colleagues_always_have_their_channel(client, sql):
    elena, ryan = two_users(client, sql)
    sql("UPDATE users SET primary_department_id = 'LEGAL_COMPLIANCE' WHERE email = 'ryan@anduin.example'")
    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]
    assert client.delete(f"{ROOM}/members/{ryan_id}", headers=elena).status_code == 409
