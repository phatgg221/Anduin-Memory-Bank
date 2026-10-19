import asyncio
import uuid

import asyncpg
import pytest

from tests.conftest import TEST_DB, _dsn
from tests.test_case_threads import AURELIAN, post, signed_in


def run_job(client, job_id):
    from app.modules.triage import service

    client.portal.call(service.process, uuid.UUID(job_id))


def jobs(client, headers):
    return client.get(f"/api/cases/{AURELIAN}/jobs", headers=headers).json()


def fetchval(query, *args):
    async def go():
        conn = await asyncpg.connect(_dsn(TEST_DB))
        try:
            return await conn.fetchval(query, *args)
        finally:
            await conn.close()

    return asyncio.run(go())


def discussion(client, elena, ryan):
    post(client, ryan, AURELIAN, "Kickoff: Cayman feeder with joint signers and a $15M MFN bracket.")
    post(
        client,
        elena,
        AURELIAN,
        "Careful: never let both signers edit the Chapter 4 election, it deadlocked Silverpine.",
    )
    body = {
        "id": str(uuid.uuid4()),
        "content": "Agreed plan: reuse cayman_fatca_v2 and the redlines.",
        "is_milestone": True,
    }
    client.post(f"/api/cases/{AURELIAN}/thread/messages", json=body, headers=ryan)


def resolve(client, headers, job_id=None):
    return client.post(f"/api/cases/{AURELIAN}/resolve", json={"job_id": job_id or str(uuid.uuid4())}, headers=headers)


def test_resolve_needs_messages_and_is_idempotent(client, sql):
    elena, ryan = signed_in(client, sql)
    assert resolve(client, elena).status_code == 409  # empty thread
    discussion(client, elena, ryan)

    job_id = str(uuid.uuid4())
    first = resolve(client, elena, job_id)
    assert first.status_code == 202 and first.json()["status"] == "QUEUED"
    assert first.json()["steps"] == [
        "Reading the case thread",
        "Drafting the memory record",
        "Checking citations",
        "Curating files & checking older cases",
    ]
    assert resolve(client, elena, job_id).json()["id"] == job_id  # retry
    assert resolve(client, ryan).json()["id"] == job_id  # second click while live: same job


def test_summary_job_drafts_a_guarded_record(client, sql):
    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)
    job_id = resolve(client, elena).json()["id"]
    run_job(client, job_id)

    job = jobs(client, elena)["summarize"]
    assert job["status"] == "COMPLETED" and job["result"]["provider"].startswith("fake")
    record = job["result"]["record"]
    assert record["resolution_steps"] == ["Agreed plan: reuse cayman_fatca_v2 and the redlines."]
    [pitfall] = record["pitfalls"]
    assert pitfall["severity"] == "HIGH" and pitfall["reference"].startswith("Chat #L")
    elena_id = client.get("/api/auth/me", headers=elena).json()["id"]
    assert pitfall["authorId"] == elena_id and pitfall["messageId"]  # set by code from the cited line


def test_commit_resolves_locks_thread_and_indexes(client, sql):
    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)
    run_job(client, resolve(client, elena).json()["id"])
    record = jobs(client, elena)["summarize"]["result"]["record"]

    edited = {**record, "summary": "Aurelian Cayman feeder: reused the joint-signer schema and sovereign redlines."}
    edited["pitfalls"] = [
        *record["pitfalls"],
        {"warning": "Invented warning with no source at all.", "severity": "LOW", "reference": "Chat #L999"},
    ]
    committed = client.post(f"/api/cases/{AURELIAN}/commit", json=edited, headers=elena)
    assert committed.status_code == 200
    body = committed.json()
    assert body["status"] == "RESOLVED" and body["index_job"]["kind"] == "INDEX"
    assert any("Chat #L999" in w for w in body["guard_warnings"])

    thread = client.get(f"/api/cases/{AURELIAN}/thread", headers=elena).json()
    assert thread["status"] == "RESOLVED"
    assert post(client, ryan, AURELIAN, "too late").status_code == 409
    assert client.post(f"/api/cases/{AURELIAN}/commit", json=edited, headers=elena).status_code == 409
    assert resolve(client, elena).status_code == 409

    stored = fetchval(f"SELECT pitfalls::text FROM case_records WHERE id = '{AURELIAN}'")
    assert "Chat #L999" not in stored  # the unverifiable reference was dropped before storing

    run_job(client, body["index_job"]["id"])
    assert jobs(client, elena)["index"]["status"] == "COMPLETED"
    chunks = fetchval(f"SELECT count(*) FROM knowledge_chunks WHERE case_id = '{AURELIAN}'")
    dims = fetchval(f"SELECT vector_dims(embedding) FROM knowledge_chunks WHERE case_id = '{AURELIAN}' LIMIT 1")
    assert chunks >= 3 and dims == 768


@pytest.mark.parametrize(
    ("message", "expected_status"),
    [("OPENROUTER_API_KEY is not set", "FAILED"), ("Provider unavailable after retries: 503", "QUEUED")],
)
def test_llm_failures_fail_fast_or_requeue(client, sql, monkeypatch, message, expected_status):
    from app.modules.intelligence import llm_client

    async def broken(*args, **kwargs):
        raise llm_client.LLMError(message)

    monkeypatch.setattr(llm_client, "complete_json", broken)
    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)
    job_id = resolve(client, elena).json()["id"]
    sql(f"UPDATE case_jobs SET status = 'PROCESSING', attempts = 1 WHERE id = '{job_id}'")
    run_job(client, job_id)
    job = jobs(client, elena)["summarize"]
    assert job["status"] == expected_status and message in job["error"]


def test_sweeper_requeues_stalled_jobs(client, sql):
    from app.modules.triage import service

    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)
    job_id = resolve(client, elena).json()["id"]
    stale = "status = 'PROCESSING', attempts = 1, heartbeat_at = now() - interval '1 hour'"
    sql(f"UPDATE case_jobs SET {stale} WHERE id = '{job_id}'")
    assert client.portal.call(service.sweep_once) == 1
    assert jobs(client, elena)["summarize"]["status"] == "QUEUED"


def test_thread_context_loads_even_when_case_already_in_session(client, sql):
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.modules.cases.models import CaseRecord
    from app.modules.triage.service import _thread_context

    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)

    async def go():
        async with SessionLocal() as session:
            case = await session.scalar(select(CaseRecord).where(CaseRecord.id == uuid.UUID(AURELIAN)))
            context, _ = await _thread_context(session, case.id)
            return context

    context = client.portal.call(go)
    assert len(context.messages) == 3 and context.artifacts == []


def test_outcome_curator_and_knowledge_base_commit(client, sql):
    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)

    def upload(name, content):
        files = {"file": (name, content, "application/octet-stream")}
        return client.post(f"/api/cases/{AURELIAN}/files", files=files, headers=elena).json()["id"]

    schema_id = upload("joint_signer_schema.json", b'{"signers": ["designated", "co-signer"]}')
    export_id = upload("aurelian_lp_export.csv", b"lp,commitment\nA,10\n")
    approval = {
        "file": ("aurelian_signoff.eml", b"Subject: Approved\n\nWe approve the new W-8 flow.", "message/rfc822")
    }
    approval_id = client.post(
        f"/api/cases/{AURELIAN}/files", files=approval, data={"file_type": "CLIENT_APPROVAL"}, headers=elena
    ).json()["id"]

    body = {
        "job_id": str(uuid.uuid4()),
        "outcome": "WORKAROUND",
        "final_output": "Delivered the Designated Tax Signatory schema; MFN bracket deferred to the next close.",
        "deliverable_file_ids": [schema_id, approval_id],
    }
    job = client.post(f"/api/cases/{AURELIAN}/resolve", json=body, headers=elena).json()
    run_job(client, job["id"])
    result = jobs(client, elena)["summarize"]["result"]
    assert result["outcome"] == "WORKAROUND" and "Delivered" in result["record"]["how_it_went"]
    suggested = {f["file_name"] for f in result["curator"]["reusable_files"]}
    assert "joint_signer_schema.json" in suggested and "aurelian_lp_export.csv" not in suggested
    assert "aurelian_signoff.eml" not in suggested  # a client sign-off is evidence, not reusable knowledge
    assert sorted(result["deliverable_file_ids"]) == sorted([schema_id, approval_id])

    commit = {
        **result["record"],
        "outcome": "WORKAROUND",
        "final_output": body["final_output"],
        "reusable_file_ids": [schema_id],
    }
    assert client.post(f"/api/cases/{AURELIAN}/commit", json=commit, headers=elena).status_code == 200
    thread = client.get(f"/api/cases/{AURELIAN}/thread", headers=elena).json()
    assert thread["outcome"] == "WORKAROUND" and thread["final_output"].startswith("Delivered")
    reusable = {a["id"]: a["is_reusable"] for a in thread["artifacts"]}
    assert reusable[schema_id] is True and reusable[export_id] is False

    bad = {"job_id": str(uuid.uuid4()), "outcome": "DONE"}
    assert client.post(f"/api/cases/{AURELIAN}/resolve", json=bad, headers=elena).status_code == 422


def test_reused_files_are_linked_and_copied_into_the_knowledge_base(client, sql):
    import io

    from app.core.config import settings
    from app.core.storage import internal
    from tests.test_case_threads import SOVEREIGN

    elena, ryan = signed_in(client, sql)
    discussion(client, elena, ryan)
    key = f"test/{uuid.uuid4()}/master_rfp.csv"
    internal.put_object(settings.minio_bucket, key, io.BytesIO(b"q,a\nDORA,yes\n"), 13, content_type="text/csv")
    reused = str(uuid.uuid4())
    sql(
        "INSERT INTO case_artifacts (id, case_id, file_name, file_type, content_type, size_bytes, is_reusable,"
        " minio_object_key, preview_text) VALUES ($1, $2, 'master_rfp.csv', 'RFP_MATRIX_CSV', 'text/csv', 13, true,"
        " $3, 'q,a DORA,yes')",
        uuid.UUID(reused),
        uuid.UUID(SOVEREIGN),
        key,
    )
    body = {"id": str(uuid.uuid4()), "content": "Reusing master_rfp.csv", "attached_artifact_id": reused}
    assert client.post(f"/api/cases/{AURELIAN}/thread/messages", json=body, headers=elena).status_code in (200, 201)
    thread = client.get(f"/api/cases/{AURELIAN}/thread", headers=elena).json()
    assert [(a["id"], a["source_case_code"]) for a in thread["linked_artifacts"]] == [(reused, "CASE-2025-052")]

    job = resolve(client, elena).json()
    run_job(client, job["id"])
    record = jobs(client, elena)["summarize"]["result"]["record"]
    commit = {**record, "final_output": "Answered the DORA tab from the master bank.", "reusable_file_ids": [reused]}
    assert client.post(f"/api/cases/{AURELIAN}/commit", json=commit, headers=elena).status_code == 200
    thread = client.get(f"/api/cases/{AURELIAN}/thread", headers=elena).json()
    copy = next(a for a in thread["artifacts"] if a["file_name"] == "master_rfp.csv")
    assert copy["id"] != reused and copy["is_reusable"] and copy["description"] == "Reused from CASE-2025-052"
    assert thread["linked_artifacts"] == []


def test_triage_asks_about_precedent_pitfalls_when_the_model_lists_none():
    from app.modules.intelligence.schemas import PrecedentContext, TriageReportDraft
    from app.modules.intelligence.triage_agent import Evidence, guard_triage

    precedent = PrecedentContext(
        uuid.uuid4(), "CASE-2025-014", "t", None, "s", "h", [], ["Joint signers deadlock Step 4."], {}, [], 90, 0.8, 0
    )
    draft = TriageReportDraft(summary="Similar to [CASE-2025-014].", risk_level="LOW")
    report, _ = guard_triage(draft, Evidence(), [precedent])
    assert report["missing_info"] == [
        {
            "question": "Joint signers deadlock Step 4.",
            "why": "This went wrong on [CASE-2025-014]. Confirm with the client it doesn't apply here.",
            "source_case_code": "CASE-2025-014",
        }
    ]


def test_triage_summary_may_cite_a_duplicate_the_tool_returned():
    from app.modules.intelligence.schemas import TriageReportDraft
    from app.modules.intelligence.triage_agent import Evidence, guard_triage

    evidence = Evidence()
    evidence.duplicates["CASE-2026-048"] = {"case_code": "CASE-2026-048"}
    draft = TriageReportDraft(summary="Duplicate of the open [CASE-2026-048].", risk_level="LOW")
    _, warnings = guard_triage(draft, evidence, [])
    assert not any("CASE-2026-048" in w for w in warnings)
