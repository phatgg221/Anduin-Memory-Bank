---
name: anduin-memory-bank
description: Architecture rules, domain knowledge, and implementation patterns for the Anduin Memory Bank hackathon project — a trigger-first case triage & delta workbench (Next.js 16 + FastAPI + PostgreSQL/pgvector + MinIO, Docker Compose, bun scripts). Use whenever creating or editing anything under frontend/ or backend/ — routes, pages, components, React Query hooks, services, FastAPI routers/services, background jobs, the intelligence pipeline, LLM prompts or Pydantic contracts, MinIO/presigned links, docker-compose or bun scripts — or when generating seed data, even if the request doesn't mention the Memory Bank by name.
---

# Anduin Memory Bank Builder

**What we're building:**
1. A new fund-onboarding request arrives.
2. The workbench extracts its metadata.
3. It surfaces the **Top 3 most similar past cases**.
4. It shows **how they went** (post-mortems, Slack warnings, `ALUMNI` knowledge).
5. It diffs **what's different this time** (REUSABLE / MODIFIED / NET_NEW).
6. It offers **1-click reuse** of past artifacts.

This is an operational workbench, not a chatbot.

- Domain, persona, glossary → `CONTEXT.md` (repo root)
- Services, flows, module layout, decisions, gotchas → `ARCHITECTURE.md` (repo root)

## 0. Before writing code

- **The table schema is not decided yet.** Don't create or change tables, columns, or migrations without asking the user, and don't lock in field names. Use the working entity names (HistoricalCase, Person, Artifact, KnowledgeChunk, TriageJob) and keep models in each module's `models.py` so they're cheap to change.
- **Features are still being concluded.** If a task needs a product decision (CONTEXT.md §7), ask instead of guessing.
- **Check `ARCHITECTURE.md` §14.** *Proposed* decisions can still change; say so when your change depends on one.

## 1. Golden rules — Frontend (`frontend/`)

- **Unidirectional flow:** `app/**/page.tsx → store/ (React Query hook) → services/*Service.ts → lib/axiosClient.ts → /api`.
- **Components are presentational.** `components/` takes props and emits callbacks. It never imports from `store/`, `services/`, or axios. Pages are thin containers that wire hooks to components.
- **One HTTP client.** `lib/axiosClient.ts` with `baseURL: "/api"`. No `fetch`, no absolute backend URLs, no second axios instance. The base URL is relative, so services only work in the browser. Pages that use store hooks are client components (`"use client"`).
- **Polling.** While a triage job is `QUEUED` or `PROCESSING`, poll about every 2 s via `refetchInterval`. Return `false` once the job is `COMPLETED` or `FAILED`, or if the query errors.
- **Query keys** live in `store/queryKeys.ts`. Never write inline key arrays.
- **Presigned links are fetched fresh on each click** (a mutation, not a cached query), because they expire.
- **Next.js 16.4** is newer than your training data. Check `frontend/node_modules/next/dist/docs/` before using an API you're unsure of.
  - **Cache Components are on.** Every dynamic segment (`[jobId]`, `[caseId]`) needs a `loading.tsx`, or `next build` fails on the `params` access. `next dev` won't warn you, so run `bun run build` in `frontend/` before calling a route done.
  - `params` / `searchParams` are Promises — use `use(params)` in client pages.
  - Turbopack is the default bundler; Tailwind 4 loads via `@tailwindcss/turbopack`.
  - `middleware.ts` is now `proxy.ts` (not needed yet).
- **ESLint enforces the layering** (`no-restricted-imports` per folder, no `fetch`). Fix violations; never disable the rule.
- **UI aesthetic — workbench, not chatbot:**
  - split-pane comparison (incoming vs. historical);
  - similarity badges (`94% Match`);
  - green / amber / red delta rows (REUSABLE / MODIFIED / NET_NEW);
  - an `Alumni Knowledge` badge on insights from people who left;
  - clickable source citations;
  - step-by-step job progress instead of a bare spinner.

Templates → `references/frontend-patterns.md`.

## 2. Golden rules — Backend (`backend/app/`)

- **Modular monolith:** `router → service → SQLAlchemy`, one folder per domain under `app/modules/` (`vault/`, `triage/`, `intelligence/`). Routers do HTTP only; services own logic and transactions.
- **Dependency direction:** `triage → intelligence → vault → core/db`.
  - Never import upward.
  - Cross-module calls go through the other module's `service.py`, never its router.
  - Only the owning module writes its tables, so `intelligence` returns results and the `triage` worker persists them.
- **Every route lives under `/api`.** The Next rewrite forwards the path unchanged; Swagger is at `/api/docs`.
- **Idempotent startup** (`main.py` lifespan), safe on every container start:
  1. `CREATE EXTENSION IF NOT EXISTS vector`
  2. Create tables via `db/schema.py`.
  3. Ensure the MinIO bucket — **non-fatal**: log the failure and let `/api/health` report it.
  4. `sweep_once()` to recover stale jobs.
  5. Start the worker and `sweeper.py` loops.

  Steps 4–5 get wired in once the job table exists.
- **Resilient jobs.** LLM triage never runs inside a request or as a fire-and-forget in-memory task.
  - Persist a job row (`QUEUED → PROCESSING → COMPLETED | FAILED`).
  - Claim it with `FOR UPDATE SKIP LOCKED`.
  - Heartbeat between pipeline steps.
  - The sweeper requeues stale `PROCESSING` jobs (e.g. after a restart), or fails them once attempts run out.
- **Strict LLM contracts.** Every LLM call goes through `modules/intelligence/llm_client.py`, returns a Pydantic model from `schemas.py`, and passes `guard.py`. **The LLM never decides IDs or similarity scores — code sets them.**
- **Don't block the event loop.** The MinIO SDK is synchronous, so wrap its network calls in `asyncio.to_thread`. Use async LLM clients.
- **Presigned links** come from a MinIO client configured with the *public* endpoint (the browser's host) and an explicit region. They are short-lived and GET-only.
- **Use the existing MinIO clients** in `core/storage.py` (`internal`, `public_signer`, and the no-retry `_probe` for health). Don't create new ones.
- **Python deps:** add them with `uv add` in `backend/`, then `bun run dev` rebuilds the image. Inside the container, commands run as plain `python` / `pytest` (the venv is on `PATH`), not `uv run`.

Templates → `references/backend-patterns.md`.

## 3. Intelligence pipeline (4-step delta engine)

`modules/intelligence/service.py` always runs these four steps, in order:

1. **Intake extraction** `extract_brief_metadata`: raw text/files → `IntakeBrief` (`client_type`, `jurisdiction`, `fund_structure`, `key_requirements[]`, `search_query`).
2. **Hybrid retrieval** `retrieve_similar_cases`:
   - embed `search_query`;
   - rank knowledge chunks by pgvector cosine distance, joined to their cases;
   - add a metadata boost (jurisdiction, client_type, fund_structure);
   - aggregate chunks per case → **Top 3** with a similarity %, plus a retrieved-context bundle.
3. **Structured delta** `compute_case_delta`: incoming request + top match (post-mortem, Slack snippets, artifact list) → `llm_client.complete_json()` → `CaseComparisonReport`.
4. **Guard** `guard.validate_report`:
   - overwrite IDs/scores with retrieval values;
   - strip any artifact/chunk ID not in that case's retrieved context;
   - record guard warnings.
   - The triage worker then persists the report on the job.

Contracts, prompt rules, guard rules, retry policy → `references/intelligence-pipeline.md`.

## 4. Seed data

Seed with realistic **Anduin private-markets operations** cases — never lorem ipsum or generic todo/e-commerce data.
- Every artifact a case names must exist as a real file in MinIO.
- Authors carry `ACTIVE` / `ALUMNI` status.
- Seeding is idempotent.

Anchor cases, distractors, and the demo trigger → `references/seed-data.md`.

## 5. Commands

Always use the root `bun` scripts:

| Command | Does |
|---|---|
| `bun run setup` | Build images, start containers, init pgvector + MinIO bucket |
| `bun run dev` | Run the stack with hot reload |
| `bun run dev --refresh-db` | Drop + recreate tables, then seed |
| `bun run stop` / `bun run logs [svc]` | Stop containers / follow logs |
| `bun run seed` | Load private-markets cases and upload artifacts to MinIO |
| `bun run test [pytest args]` | `pytest` inside the backend container (use `bun run test`, not `bun test`) |
| `bun run lint` | Frontend ESLint + backend ruff |
| `bun run reset` | Tear down containers **and volumes** — destructive, confirm with the user first |

Postgres is published on host port **5433** (not 5432). Every host port is set in the root `.env`.

## 6. Reference files

| File | Read when |
|---|---|
| `references/frontend-patterns.md` | Adding a page, hook, service, or component; touching `next.config.ts` or types |
| `references/backend-patterns.md` | Adding a module or route; touching lifespan, DB session, jobs/worker/sweeper, MinIO, settings |
| `references/intelligence-pipeline.md` | Changing extraction, retrieval, delta prompts, LLM schemas, guard, or providers |
| `references/seed-data.md` | Writing or extending `seed.py`, demo inputs, or retrieval tests |
