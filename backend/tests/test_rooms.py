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


def two_users(client, sql):
    elena = bearer(register(client, email="elena@anduin.example", name="Elena Rostova").json()["access_token"])
    ryan = bearer(register(client, email="ryan@anduin.example", name="Ryan Miller").json()["access_token"])
    sql("INSERT INTO departments (id, code, name) VALUES ('CLIENT_OPERATIONS', 'OPS', 'Client Operations')")
    sql(SETUP)
    return elena, ryan


def post(client, headers, content, message_id=None):
    return client.post(
        f"{ROOM}/messages", json={"id": str(message_id or uuid.uuid4()), "content": content}, headers=headers
    )


def test_lead_is_a_member_by_default(client, sql):
    elena, ryan = two_users(client, sql)
    view = client.get(ROOM, headers=ryan).json()
    assert [(m["user"]["name"], m["role"]) for m in view["members"]] == [("Elena Rostova", "LEAD")]
    assert view["is_member"] is False

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
