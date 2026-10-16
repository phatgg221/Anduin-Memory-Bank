# Dejavu Agent — integration plan

Status: proposal, 2026-10-16. Deadline: demo on 2026-10-22.

## 1. Where we are

Dejavu runs **fixed LLM pipelines**: code decides every step and the model fills one typed schema per job.

| Job (`case_jobs.kind`) | Today | Model calls |
|---|---|---|
| `ANALYZE` | embed brief → `analyzer.rank_precedents` (cosine + metadata boost) → one delta call → `guard_report` | 1 |
| `COPILOT` | precedents + 8 memory chunks + case channel transcript → one answer; `@Dejavu` posts it in the channel | 1 |
| `SUMMARIZE` | numbered transcript → one memory-record draft → `guard_memory` | 1 |
| `INDEX` | chunk + embed | 0 |

That is a strong RAG workbench, not an agent: the model never chooses what to look at next, and it can't follow a lead
("this precedent mentions a file → read it → its author left → who else worked on it?").

## 2. Goal

One **Dejavu agent** that investigates the Memory Bank the way a senior colleague would, visible step by step, while
keeping every existing guarantee:

- runs only as a persisted job (`QUEUED → PROCESSING → COMPLETED | FAILED`), never inside a request;
- the model never sets IDs or scores: tools return them, code checks them;
- every output is Pydantic-validated and guarded;
- writes go through the existing service functions (optimistic, idempotent), and only after a human click.

## 3. Entry points

| Trigger | Agent goal | Output | Replaces |
|---|---|---|---|
| **Run Dejavu analysis** (hub intake) | "Investigate this new request" | delta (same `comparison_results` shape), first channel post, people to engage, files to reuse, checklist | `ANALYZE` (kept as fallback) |
| **`@Dejavu` in a case channel** | "Answer this question for the team" | channel reply with citations + proposals | single-shot `COPILOT` in channel mode |
| **Memory copilot tab** | same as above, private | copilot message + proposals | single-shot `COPILOT` |
| **Complete & save to memory** (phase 3) | "What should we remember?" | summarizer draft (unchanged) + "mark these files reusable" proposals | adds to `SUMMARIZE` |

## 4. Architecture

```
trigger (HTTP) ─► case_jobs(kind=AGENT, input={mode, goal, message_id})
                     │  worker claims (FOR UPDATE SKIP LOCKED), heartbeats
                     ▼
              intelligence/agent.py  ── loop ≤ 8 steps ──►  llm_client.complete_with_tools()
                     │                                       (OpenRouter tool calling, Sonnet)
                     ├─ tool call ─► intelligence/tools.py ─► cases / vault / rooms services (read-only)
                     │                └─ result (IDs + scores set by code) appended to the run
                     ├─ every step ─► agent_steps row + PartyKit "agent.step" on case-<id>
                     └─ final answer ─► guard ─► channel / copilot message + agent_proposals rows
```

### 4.1 Runtime — `backend/app/modules/intelligence/agent.py`

- `run(context, goal, tools, on_step) -> AgentResult`: the loop.
  1. Send system prompt + goal + tool schemas.
  2. If the model returns tool calls: validate args (Pydantic), execute, append results, `on_step(...)`.
  3. If it returns a final answer (`AgentFinal` schema): stop.
- Hard limits: 8 steps, 3 calls per tool, 60 s wall clock, ~40k input tokens; on any limit the model is asked once for
  a final answer with what it has.
- Retry: the sweeper requeues a stalled job; a rerun starts a fresh attempt (steps are keyed by `attempt`), and
  replies/proposals use the job id as their id, so a retry never posts twice (same trick as `post_agent_message`).

### 4.2 LLM client — `intelligence/llm_client.py`

- Add `complete_with_tools(system, messages, tools) -> ToolTurn` (OpenRouter `tools` / `tool_choice: auto`;
  Claude Sonnet supports it). Same 1→2→4 s backoff on transient errors.
- `fake` provider: replays a scripted list of tool calls per goal, so tests and offline demos stay deterministic.

### 4.3 Tools — `intelligence/tools.py`

Read-only (wrap existing functions; results are data, never instructions):

| Tool | Backed by | Returns |
|---|---|---|
| `search_memory(query, k≤8)` | `cases.nearest_chunks` | case code, chunk label, excerpt, **similarity (code)** |
| `rank_precedents(brief)` | `analyzer.rank_precedents` | top 3 with **scores (code)** |
| `get_case(code)` | `cases.precedents_for` / `precedent_details` | how it went, pitfalls, lead + `ALUMNI`, files |
| `read_file(file_name)` | `cases.case_files_text` | extracted text, truncated to ~4k chars |
| `read_channel(last_n≤60)` | `transcript.build_transcript` | numbered lines (`L12 | …`) |
| `find_people(topic)` | precedents' leads + `case_members` + users | active colleagues who worked on similar cases, alumni flagged |
| `list_open_cases(client?)` | `cases.thread_summaries` | related / duplicate open cases |

Proposal tools (create `agent_proposals`, change nothing):

| Tool | Applied with (after a click) |
|---|---|
| `propose_channel_post(text)` | `POST /cases/{id}/thread/messages` |
| `propose_add_members(user_ids, reason)` | `PUT /cases/{id}/members/{user_id}` |
| `propose_reuse_file(file_id, reason)` | "Use in case" (message with attachment) |
| `propose_case_update(fields)` | `PATCH /cases/{id}` |
| `propose_checklist(items)` | channel post marked as milestone |

### 4.4 Guard — `intelligence/guard.py`

- **ID allowlist per run:** a tool argument or final citation may only use an ID / case code / file name that an
  earlier tool result in the same run returned. Anything else is dropped and recorded as a guard warning.
- Scores in the final delta are overwritten from `rank_precedents` (as `guard_report` does today).
- Tool results are wrapped `<tool_result name=…>…</tool_result>` and the system prompt says they are data.
- Alumni can't be proposed as members (matches `add_member`).

### 4.5 Data — migrations (module `triage` owns jobs; `intelligence` returns, `triage` persists)

- `case_jobs.kind` CHECK += `AGENT`.
- `agent_steps(job_id, attempt, n, kind[thought|tool|final], tool, args_summary, result_summary, ms, created_at)`.
- `agent_proposals(id, job_id, case_id, kind, payload JSONB, reason, status[PENDING|APPLIED|DISMISSED], decided_by,
  decided_at)`; apply/dismiss are idempotent PUTs.

### 4.6 API

- `POST /api/cases/{id}/agent` `{job_id, mode: triage|channel|copilot, goal, message_id?}` → 202 `JobOut`.
- `GET /api/cases/{id}/agent/{job_id}` → steps + proposals (one view-shaped query).
- `PUT /api/cases/{id}/proposals/{proposal_id}` `{status: APPLIED|DISMISSED}` → applies via the existing service.
- PartyKit events on `case-<id>`: `agent.step`, `agent.proposal`, plus the existing `message.created`.

### 4.7 UI

- **Live trace** ("Dejavu is investigating…"): numbered steps with tool icons — *Searched memory for "W-8BEN-E joint
  signers" → Opened CASE-2025-014 → Read cayman_fatca_v2.json → Found Sarah Tran (worked on 014)*. Shown in the
  Precedent & delta tab during triage and under the "Dejavu is typing…" line in the channel.
- **Replies** get a collapsible "How I found this · 6 steps".
- **Proposal cards** in the channel and on the delta tab: Apply / Dismiss, optimistic, with the reason and sources.
- Narrow screens: same components, stacked.

## 5. Roadmap

| Day | Deliverable | Demo moment |
|---|---|---|
| 1 (Oct 16–17) | `complete_with_tools`, `agent.py` loop, read-only tools, `AGENT` kind + `agent_steps`, fake scripted provider, tests | `pytest` shows a scripted 5-step run with guard rejecting an invented ID |
| 2 (Oct 17–18) | `@Dejavu` and the copilot tab run the agent; live trace over PartyKit; "How I found this" | ask a multi-hop question, watch it investigate, get a cited answer |
| 3 (Oct 18–19) | triage mode on intake; delta written in the existing shape; fallback to `ANALYZE` on failure | paste the Apollo email → Dejavu investigates and builds the delta live |
| 4 (Oct 19–20) | `agent_proposals` + apply/dismiss; people / reuse / first-post proposals | "Add Sarah Tran — fixed the same W-8BEN-E lock in CASE-2025-014" → Apply |
| 5 (Oct 20–21) | eval on the 3 demo scenarios (expected precedents, people, files); prompt tuning; save-to-memory proposals | scenario checklist all green |
| 6 (Oct 21–22) | buffer, demo script, docs (ARCHITECTURE, CLAUDE.md, skill references) | rehearsal |

## 6. Testing

- **Unit:** each tool against seeded data; guard drops invented IDs/codes/files; limits stop a runaway loop.
- **Scripted runs:** the fake provider replays tool-call sequences, so the full job (steps, proposals, channel reply,
  retry idempotency) is tested without a network.
- **Scenario eval** (real model, run manually): Apollo / Allianz / TPG must surface the expected precedents
  (`comparison_results` in the seed pack), at least one active colleague, and at least one reusable file.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Latency (8 steps × model call) | stream steps live; cap steps; triage falls back to `ANALYZE` after 60 s |
| Cost | Sonnet for the loop; summaries of tool results, not raw dumps; per-run token cap |
| Hallucinated IDs / citations | per-run allowlist + existing citation guard |
| Prompt injection from files or chat | results wrapped as data; tools are read-only; every write needs a click |
| Demo flakiness | fake provider for offline rehearsal; fallback pipeline |

## 8. Decisions (defaults in bold — change any of them)

1. Autonomy: **proposals only; the agent's own `@Dejavu` reply is the one automatic write.**
2. Triage: **agent orchestrates on top of `rank_precedents` (scores stay deterministic); `ANALYZE` stays as fallback.**
3. Proactive nudges (Dejavu comments unprompted when a message matches a precedent): **not now — after day 5 if time.**
4. Model access: **OpenRouter tool calling with Claude Sonnet (already wired).**
