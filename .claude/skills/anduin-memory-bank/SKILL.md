---
name: anduin-memory-bank
description: Architecture rules, design system, domain knowledge, and implementation patterns for Dejavu (repo name Anduin Memory Bank) — a trigger-first case triage & delta workbench (Next.js 16 + shadcn/ui + FastAPI + PostgreSQL/pgvector + MinIO, Docker Compose, bun scripts). Use whenever creating or editing anything under frontend/ or backend/ — pages, layouts, UI components, styling, colors, Tailwind classes, shadcn components, React Query hooks, services, FastAPI routers/services, background jobs, the intelligence pipeline, LLM prompts or Pydantic contracts, MinIO/presigned links, docker-compose or bun scripts — or when generating seed data, even if the request doesn't mention Dejavu or the Memory Bank by name.
---

# Dejavu (Anduin Memory Bank) Builder

**What we're building:**
1. A new fund-onboarding request arrives.
2. The workbench extracts its metadata.
3. It surfaces the **Top 3 most similar past cases**.
4. It shows **how they went** (post-mortems, Slack warnings, `ALUMNI` knowledge).
5. It diffs **what's different this time** (REUSABLE / MODIFIED / NET_NEW).
6. It offers **1-click reuse** of past artifacts.

This is an operational workbench, not a chatbot. The product is branded **Dejavu** (`▲ Dejavu // by Anduin`).

- Domain, persona, glossary → `CONTEXT.md` (repo root)
- Services, flows, module layout, decisions, gotchas → `ARCHITECTURE.md` (repo root)
- Brand, tokens, views, signature components → `DESIGN.md` (repo root)

## 0. Before writing code

- **Domain tables are not decided yet.** Don't create vault/triage tables or lock in field names without asking the user. Use the working entity names (HistoricalCase, Person, Artifact, KnowledgeChunk, TriageJob). The auth tables (`users`, `refresh_tokens`) exist.
- **Every schema change is an Alembic migration:** change `models.py` → `bun run db:revision "msg"` → review the file → `bun run db:migrate`. Never use `create_all`. Details: `references/backend-patterns.md` § Schema changes.
- **Features are still being concluded.** If a task needs a product decision (CONTEXT.md §7), ask instead of guessing.
- **Check `ARCHITECTURE.md` §14.** *Proposed* decisions can still change; say so when your change depends on one.

## 1. Golden rules — Frontend (`frontend/`)

- **Unidirectional flow:** `app/**/page.tsx → store/ (React Query hook) → services/*Service.ts → lib/axiosClient.ts → /api`.
- **Components are presentational.** `components/` takes props and emits callbacks. It never imports from `store/`, `services/`, or axios. Pages are thin containers that wire hooks to components.
- **One HTTP client.** `lib/axiosClient.ts` with `baseURL: "/api"`. No `fetch`, no absolute backend URLs, no second axios instance. The base URL is relative, so services only work in the browser. Pages that use store hooks are client components (`"use client"`).
- **Polling.** While a triage job is `QUEUED` or `PROCESSING`, poll about every 2 s via `refetchInterval`. Return `false` once the job is `COMPLETED` or `FAILED`, or if the query errors.
- **Query keys** live in `store/queryKeys.ts`. Never write inline key arrays.
- **Auth on the client:**
  - The access token lives only in memory (`lib/accessToken.ts`) — never localStorage. `lib/axiosClient.ts` attaches it, and on a 401 runs one shared `/auth/refresh` and retries.
  - Session state: `useSession()` in `store/auth.ts`.
  - **`proxy.ts` gates pages server-side, default-deny.** Any new page is protected automatically. To make a page public, add it to `AUTH_PAGES` in `lib/safeRedirect.ts` (auth pages) or extend the proxy deliberately. Never verify sessions against the DB in the proxy.
  - Signed-in pages go under `app/(app)/`, which restores the session (catching revoked tokens) and holds the nav. Public auth pages go under `app/(auth)/`.
  - A layout must always render `{children}`: hide them rather than drop them, or Next's instant-navigation validation complains.
- **Presigned links are fetched fresh on each click** (a mutation, not a cached query), because they expire.
- **Next.js 16.4** is newer than your training data. Check `frontend/node_modules/next/dist/docs/` before using an API you're unsure of.
  - **Cache Components are on.** Every dynamic segment (`[jobId]`, `[caseId]`) needs a `loading.tsx`, or `next build` fails on the `params` access. `next dev` won't warn you, so run `bun run build` in `frontend/` before calling a route done.
  - `params` / `searchParams` are Promises — use `use(params)` in client pages.
  - Turbopack is the default bundler; Tailwind 4 loads via `@tailwindcss/turbopack`.
  - `middleware.ts` is now `proxy.ts` (not needed yet).
- **ESLint enforces the layering** (`no-restricted-imports` per folder, no `fetch`). Fix violations; never disable the rule.
- **Design system — Anduin's Swiss grid** (full rules: `references/design-system.md`):
  - **Look:** white + cool-slate surfaces, navy `#0F2547` structure, cyan `#2998FF` accent, 1px `#D6DCE5` hairlines. **Square corners, no shadows** (both enforced globally), light theme only.
  - **Tokens, not hex:** `bg-surface-2`, `bg-surface-3`, `bg-navy`, `bg-brand-cyan`, `text-muted-foreground`, `border`, plus status tokens. Never `bg-[#…]`.
  - **Primitives:** shadcn/ui (Radix, Nova) in `components/ui/`. Signature pieces live in `components/brand/`; use them first:
    - `SectionLabel` (`■ 01 / INCOMING REQUEST`) opens every pane;
    - `ActionButton` (ink fill + boxed `↗`) for primary CTAs;
    - `StatusBadge` (REUSABLE / MODIFIED / NET_NEW) and `AlumniBadge` (`[■ ALUMNI ARCHIVE]`);
    - `SimilarityMeter` (`#01 · 94% MATCH`);
    - `IsometricStack` for empty states.
  - **Workbench, not chatbot:**
    - a 3-pane grid divided by hairlines (01 request · 02 precedent & delta · 03 reusable kit & source);
    - clickable source citations;
    - step-by-step job progress instead of a bare spinner.
  - **Cyan is never text** (2.99:1 contrast). Status always carries its label, never colour alone.

Templates → `references/frontend-patterns.md` (data flow) and `references/design-system.md` (UI).

## 2. Golden rules — Backend (`backend/app/`)

- **Modular monolith:** `router → service → SQLAlchemy`, one folder per domain under `app/modules/` (`vault/`, `triage/`, `intelligence/`). Routers do HTTP only; services own logic and transactions.
- **`app/core/` is shared infrastructure** (`config`, `db`, `security`, `storage`, `migrations`); domain code lives in `app/modules/`.
- **Dependency direction:** `triage → intelligence → vault → core`. Any module may use `auth.deps.CurrentUser`.
  - Never import upward.
  - Cross-module calls go through the other module's `service.py`, never its router.
  - Only the owning module writes its tables, so `intelligence` returns results and the `triage` worker persists them.
- **Every route lives under `/api`.** The Next rewrite forwards the path unchanged; Swagger is at `/api/docs`.
- **Idempotent startup**, safe on every container start:
  1. The container CMD runs `alembic upgrade head`, then uvicorn. pgvector comes from the first migration.
  2. Lifespan: ensure the MinIO bucket — **non-fatal**: log the failure and let `/api/health` report it.
  3. Lifespan: `sweep_once()` to recover stale jobs.
  4. Lifespan: start the worker and `sweeper.py` loops.

  Steps 3–4 get wired in once the job table exists.
- **Auth:**
  - Protect every new domain route with `user: CurrentUser` (from `app.modules.auth.deps`). Only `/api/health` and `/api/auth/*` are public.
  - Tokens: a short-lived JWT access token (bearer), plus a rotating refresh token in an httpOnly cookie (`Path=/`, `SameSite=Lax`).
  - `frontend/proxy.ts` verifies that cookie (signature only) to gate pages. The API stays the real enforcement.
  - Password hashing and JWT helpers live in `app/core/security.py`.
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
| `bun run setup` | Sync `.env` (generates `JWT_SECRET`), build images, start containers (migrations apply on backend start) |
| `bun run dev` | Run the stack with hot reload |
| `bun run dev --refresh-db` | Wipe the DB, re-apply every migration, then seed |
| `bun run db:revision "msg" [--empty]` | Autogenerate a migration from the models (or a blank one) |
| `bun run db:migrate [rev]` / `db:downgrade [rev]` | Apply / roll back migrations |
| `bun run db:current` / `db:history` / `db:check` | DB revision / all revisions / fail on model drift |
| `bun run db:reset` | Wipe the dev DB and re-apply every migration (asks first) |
| `bun run stop` / `bun run logs [svc]` | Stop containers / follow logs |
| `bun run seed` | Load private-markets cases and upload artifacts to MinIO |
| `bun run test [pytest args]` | `pytest` inside the backend container (use `bun run test`, not `bun test`) |
| `bun run lint` | Frontend ESLint + backend ruff |
| `bun run reset` | Tear down containers **and volumes** — destructive, confirm with the user first |

Postgres is published on host port **5433** (not 5432). Every host port is set in the root `.env`.

## 6. Reference files

| File | Read when |
|---|---|
| `references/design-system.md` | Any UI work: styling, colours, layout, shadcn components, brand components, empty/loading states |
| `references/frontend-patterns.md` | Adding a page, hook, service, or component; touching `next.config.ts` or types |
| `references/backend-patterns.md` | Adding a module or route; touching lifespan, DB session, jobs/worker/sweeper, MinIO, settings |
| `references/intelligence-pipeline.md` | Changing extraction, retrieval, delta prompts, LLM schemas, guard, or providers |
| `references/seed-data.md` | Writing or extending `seed.py`, demo inputs, or retrieval tests |
