import uuid

from tests.test_case_threads import APOLLO, SOVEREIGN, new_case, post, signed_in
from tests.test_memory import run_job

SOVEREIGN_FILE = "00000000-0000-0000-0000-0000000000f1"


def with_indexed_precedent(client, sql, elena):
    """Give the resolved sovereign case a reusable file and index it, so it can be matched."""
    from app.modules.triage import service

    sql(
        f"""INSERT INTO case_artifacts (id, case_id, file_name, file_type, content_type, size_bytes, is_reusable,
                                     minio_object_key, preview_text)
            VALUES ('{SOVEREIGN_FILE}', '{SOVEREIGN}', 'mfn_tier_eligibility_matrix.csv', 'MATRIX_CSV', 'text/csv', 10,
                    true, 'cases/case-sovereign/artifacts/mfn_tier_eligibility_matrix.csv', 'clause,bracket')"""
    )
    sql(
        f"""UPDATE case_records SET summary = 'Sovereign LPs rejected the indemnity; MFN split into $25M and $50M+.',
            how_it_went = 'Four redline rounds over three weeks.', context_tags = '{{"Document": "Side Letter"}}'
            WHERE id = '{SOVEREIGN}'"""
    )
    job = client.portal.call(lambda: _enqueue_index(service))
    run_job(client, str(job))


async def _enqueue_index(service):
    from app.core.db import SessionLocal

    async with SessionLocal() as session:
        job = await service.enqueue(session, uuid.uuid4(), uuid.UUID(SOVEREIGN), "INDEX", None)
        return job.id


def test_open_cases_list_shows_top_match(client, sql):
    elena, _ = signed_in(client, sql)
    rooms = client.get("/api/cases", headers=elena).json()
    apollo = next(r for r in rooms if r["case_code"] == "CASE-2026-047")
    assert (apollo["top_match_code"], apollo["top_match_score"]) == ("CASE-2025-052", 84)
    assert all(r["status"] == "OPEN" for r in rooms)
    legal = client.get("/api/cases", params={"department_id": "SALES_SOLUTIONS"}, headers=elena).json()
    assert legal == []


def test_analysis_ranks_guards_and_stores_the_delta(client, sql):
    elena, _ = signed_in(client, sql)
    with_indexed_precedent(client, sql, elena)
    case = new_case(
        client,
        elena,
        title="Sovereign wealth side letter with an MFN tier at $15M",
        initial_request_brief="A sovereign wealth fund LP wants a side letter with sovereign immunity and an MFN tier.",
        context_tags={"Document": "Side Letter"},
        source_type="LEGAL_REDLINE",
        fund_name="Meridian IV",
    ).json()

    job = client.post(f"/api/cases/{case['id']}/analyze", json={"job_id": str(uuid.uuid4())}, headers=elena).json()
    assert job["kind"] == "ANALYZE" and job["steps"][0] == "Reading the incoming request"
    run_job(client, job["id"])
    done = client.get(f"/api/cases/{case['id']}/jobs", headers=elena).json()["analyze"]
    assert done["status"] == "COMPLETED", done["error"]

    view = client.get(f"/api/cases/{case['id']}/thread", headers=elena).json()
    [top] = view["precedents"]
    assert top["case_code"] == "CASE-2025-052" and 0 < top["similarity_score"] <= 99
    assert top["score_breakdown"]["metadataBoost"] >= 3  # "Side Letter" tag + shared department
    [item] = top["delta_items"]
    assert item["status"] == "REUSABLE" and item["source_artifact_id"] == SOVEREIGN_FILE
    assert top["lead_is_alumni"] is True and top["artifacts"][0]["file_name"] == "mfn_tier_eligibility_matrix.csv"


def test_guard_drops_unknown_cases_and_files_and_keeps_net_new_on_top():
    from app.modules.intelligence.analyzer import guard_report
    from app.modules.intelligence.schemas import (
        CaseComparisonReport,
        DeltaItemDraft,
        PrecedentComparisonDraft,
        PrecedentContext,
    )

    def precedent(code, files):
        return PrecedentContext(uuid.uuid4(), code, "t", None, "s", "h", [], [], files, [], 80, 0.7, 0)

    a = precedent("CASE-2025-001", {"real.csv": uuid.uuid4()})
    b = precedent("CASE-2025-002", {})
    item = {"past_approach": "p", "current_requirement": "c", "action_recommendation": "a"}
    report = CaseComparisonReport(
        comparisons=[
            PrecedentComparisonDraft(
                case_code="CASE-2025-001",
                how_past_case_went="It went fine overall",
                delta_items=[
                    DeltaItemDraft(category="signers", status="REUSABLE", source_artifact="invented.pdf", **item)
                ],
            ),
            PrecedentComparisonDraft(
                case_code="CASE-2025-002",
                how_past_case_went="It went badly overall",
                delta_items=[DeltaItemDraft(category="crypto", status="NET_NEW", source_artifact="real.csv", **item)],
            ),
            PrecedentComparisonDraft(case_code="CASE-1999-999", how_past_case_went="An invented case entirely"),
        ]
    )
    results, warnings = guard_report(report, [a, b])
    assert [r["caseCode"] for r in results] == ["CASE-2025-001", "CASE-2025-002"]
    assert [r["similarityScore"] for r in results] == [80, 80]  # from retrieval, not the model
    assert results[0]["deltaItems"][0]["sourceArtifact"] is None  # invented file removed
    assert [i["category"] for i in results[0]["deltaItems"]] == ["signers", "crypto"]  # NET_NEW moved to the top match
    assert results[1]["deltaItems"] == []
    assert any("CASE-1999-999" in w for w in warnings) and any("invented.pdf" in w for w in warnings)


def test_copilot_answers_with_checked_citations(client, sql):
    elena, _ = signed_in(client, sql)
    message_id, job_id = str(uuid.uuid4()), str(uuid.uuid4())
    body = {"message_id": message_id, "job_id": job_id, "question": "Why did the sovereign case take three weeks?"}
    asked = client.post(f"/api/cases/{APOLLO}/copilot", json=body, headers=elena)
    assert asked.status_code == 202 and asked.json()["kind"] == "COPILOT"
    assert client.post(f"/api/cases/{APOLLO}/copilot", json=body, headers=elena).json()["id"] == job_id  # retry

    pending = client.get(f"/api/cases/{APOLLO}/copilot", headers=elena).json()
    assert [m["role"] for m in pending["messages"]] == ["user"] and len(pending["jobs"]) == 1

    run_job(client, job_id)
    view = client.get(f"/api/cases/{APOLLO}/copilot", headers=elena).json()
    assert [m["role"] for m in view["messages"]] == ["user", "assistant"] and view["jobs"] == []
    answer = view["messages"][1]
    assert "[CASE-2025-052]" in answer["content"] and answer["cited_case_ids"] == [SOVEREIGN]


def test_use_a_precedent_file_in_the_case_thread(client, sql):
    elena, _ = signed_in(client, sql)
    with_indexed_precedent(client, sql, elena)
    body = {"id": str(uuid.uuid4()), "content": "Reusing David's MFN matrix", "attached_artifact_id": SOVEREIGN_FILE}
    posted = client.post(f"/api/cases/{APOLLO}/thread/messages", json=body, headers=elena)
    assert posted.status_code == 200
    assert posted.json()["attached_artifact"]["file_name"] == "mfn_tier_eligibility_matrix.csv"
    missing = {**body, "id": str(uuid.uuid4()), "attached_artifact_id": str(uuid.uuid4())}
    assert client.post(f"/api/cases/{APOLLO}/thread/messages", json=missing, headers=elena).status_code == 404


def test_upload_a_client_file(client, sql):
    elena, _ = signed_in(client, sql)
    files = {"file": ("apollo request.txt", b"Joint signers locked at Step 4 W-8BEN-E", "text/plain")}
    uploaded = client.post(f"/api/cases/{APOLLO}/files", files=files, headers=elena)
    assert uploaded.status_code == 201
    assert uploaded.json()["file_name"] == "apollo_request.txt" and uploaded.json()["file_type"] == "CLIENT_BRIEF"
    again = client.post(f"/api/cases/{APOLLO}/files", files=files, headers=elena)  # same name: replaced, not duplicated
    assert again.json()["id"] == uploaded.json()["id"]

    view = client.get(f"/api/cases/{APOLLO}/thread", headers=elena).json()
    assert [a["file_name"] for a in view["artifacts"]] == ["apollo_request.txt"]
    bad = {"file": ("payload.exe", b"MZ", "application/octet-stream")}
    assert client.post(f"/api/cases/{APOLLO}/files", files=bad, headers=elena).status_code == 422
    assert client.post(f"/api/cases/{SOVEREIGN}/files", files=files, headers=elena).status_code == 409
    assert post(client, elena, APOLLO, "uploaded").status_code == 200


def test_ask_dejavu_in_the_case_channel(client, sql):
    elena, ryan = signed_in(client, sql)
    ryan_id = client.get("/api/auth/me", headers=ryan).json()["id"]
    message = {
        "id": str(uuid.uuid4()),
        "content": "@Ryan Miller can you check the W-8 flow? @Dejavu why did the sovereign case take three weeks?",
        "mentioned_user_ids": [ryan_id, "00000000-0000-0000-0000-0000000000d1"],  # alumni mentions are dropped
    }
    posted = client.post(f"/api/cases/{APOLLO}/thread/messages", json=message, headers=elena).json()
    assert posted["mentioned_user_ids"] == [ryan_id] and posted["is_agent"] is False
    members = client.get(f"/api/cases/{APOLLO}/thread", headers=elena).json()["members"]
    assert {m["user"]["name"] for m in members} >= {"Elena Rostova", "Ryan Miller"}

    job_id = str(uuid.uuid4())
    body = {"message_id": message["id"], "job_id": job_id, "question": message["content"], "reply_in_channel": True}
    asked = client.post(f"/api/cases/{APOLLO}/copilot", json=body, headers=elena).json()
    assert asked["in_channel"] is True
    view = client.get(f"/api/cases/{APOLLO}/copilot", headers=elena).json()
    assert view["messages"] == [] and view["jobs"][0]["in_channel"] is True  # nothing in the copilot tab

    run_job(client, job_id)
    run_job(client, job_id)  # a retried job posts once
    thread = client.get(f"/api/cases/{APOLLO}/thread", headers=elena).json()["messages"]
    reply = thread[-1]
    assert [m["id"] for m in thread].count(job_id) == 1
    assert reply["id"] == job_id and reply["is_agent"] is True and reply["author"] is None
    assert "[CASE-2025-052]" in reply["content"]
