from tests.test_auth import bearer, register

DEPARTMENTS = """
INSERT INTO departments (id, code, name) VALUES
  ('CLIENT_OPERATIONS', 'OPS', 'Client Operations & Onboarding'),
  ('LEGAL_COMPLIANCE', 'LEGAL', 'Legal & Compliance'),
  ('SALES_SOLUTIONS', 'SALES', 'Sales & Solutions Architecture')
"""
CASES = """
INSERT INTO case_records (id, case_code, channel_slug, title, department_id, secondary_department_ids, status,
                          initial_request_brief, resolved_at) VALUES
  ('00000000-0000-0000-0000-000000000014', 'CASE-2025-014', 'case-sequoia', 'Sequoia joint signers',
   'CLIENT_OPERATIONS', '[]', 'RESOLVED', 'brief', now()),
  ('00000000-0000-0000-0000-000000000052', 'CASE-2025-052', 'case-sovereign', 'Sovereign side letter',
   'LEGAL_COMPLIANCE', '["CLIENT_OPERATIONS"]', 'RESOLVED', 'brief', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000047', 'CASE-2026-047', 'case-apollo', 'Apollo (open)', 'CLIENT_OPERATIONS',
   '[]', 'OPEN', 'brief', NULL);
INSERT INTO case_artifacts (id, case_id, file_name, file_type, content_type, size_bytes, is_reusable, minio_object_key)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000014', 'cayman_fatca_v2.json',
        'JSON_SCHEMA', 'application/json', 10, true, 'cases/case-sequoia/artifacts/cayman_fatca_v2.json')
"""


def signed_in(client, sql):
    sql(DEPARTMENTS)
    return bearer(register(client).json()["access_token"])


def test_departments_require_auth_and_list_alphabetically(client, sql):
    assert client.get("/api/org/departments").status_code == 401
    headers = signed_in(client, sql)
    names = [d["name"] for d in client.get("/api/org/departments", headers=headers).json()]
    assert names == sorted(names) and len(names) == 3


def test_active_department_is_saved_cleared_and_validated(client, sql):
    headers = signed_in(client, sql)
    put = client.put("/api/auth/me/active-department", json={"department_id": "LEGAL_COMPLIANCE"}, headers=headers)
    assert put.status_code == 200 and put.json()["active_department_id"] == "LEGAL_COMPLIANCE"
    assert client.get("/api/auth/me", headers=headers).json()["active_department_id"] == "LEGAL_COMPLIANCE"

    again = client.put("/api/auth/me/active-department", json={"department_id": "LEGAL_COMPLIANCE"}, headers=headers)
    assert again.status_code == 200  # idempotent

    cleared = client.put("/api/auth/me/active-department", json={"department_id": None}, headers=headers)
    assert cleared.json()["active_department_id"] is None

    unknown = client.put("/api/auth/me/active-department", json={"department_id": "NOPE"}, headers=headers)
    assert unknown.status_code == 422


def test_vault_filters_by_owning_or_involved_department(client, sql):
    headers = signed_in(client, sql)
    sql(CASES)

    everything = client.get("/api/vault/cases", headers=headers).json()
    assert [c["case_code"] for c in everything["cases"]] == ["CASE-2025-014", "CASE-2025-052"]  # resolved only
    assert everything["total"] == 2
    assert everything["counts"] == {"CLIENT_OPERATIONS": 2, "LEGAL_COMPLIANCE": 1, "SALES_SOLUTIONS": 0}
    assert everything["cases"][0]["artifacts"][0]["file_name"] == "cayman_fatca_v2.json"

    legal = client.get("/api/vault/cases", params={"department_id": "LEGAL_COMPLIANCE"}, headers=headers).json()
    assert [c["case_code"] for c in legal["cases"]] == ["CASE-2025-052"]
    sales = client.get("/api/vault/cases", params={"department_id": "SALES_SOLUTIONS"}, headers=headers).json()
    assert sales["cases"] == []


def test_artifact_link_is_presigned_and_404s_for_unknown(client, sql):
    headers = signed_in(client, sql)
    sql(CASES)
    link = client.post("/api/vault/artifacts/00000000-0000-0000-0000-0000000000a1/link", headers=headers)
    assert link.status_code == 200
    assert "cases/case-sequoia/artifacts/cayman_fatca_v2.json" in link.json()["url"]
    assert "X-Amz-Signature" in link.json()["url"]
    missing = client.post("/api/vault/artifacts/00000000-0000-0000-0000-0000000000ff/link", headers=headers)
    assert missing.status_code == 404
