# Architecture — Anduin Memory Bank

> **Status (2026-10-15):**
> - **Built:** the stack runs end to end; email/password auth works (JWT access token + rotating, revocable refresh token, §10a); the schema is managed by Alembic migrations.
> - **Not designed yet:** domain tables for vault/triage, which wait for the feature set (§9). So there are no domain routes, job worker, or seed data yet.
> - Decisions marked *Proposed* in §14 can still change.
>
> Related: [CONTEXT.md](CONTEXT.md) (domain & product) · `.claude/skills/anduin-memory-bank/` (coding rules & code patterns)

## 1. System Overview

Everything runs in Docker Compose from one monorepo. The browser reaches the backend **only** through the frontend's `/api/*` rewrite proxy. The one exception is raw case files (PDFs, JSON schemas, Slack exports): they download or preview straight from MinIO through short-lived presigned links.

```text
Browser ──(http://localhost:3000)──▶ frontend · Next.js 16
   │                                    │  rewrite  /api/:path*  →  http://backend:8000/api/:path*
   │                                    ▼
   │                                 backend · FastAPI ──▶ postgres + pgvector
   │                                    ├──────────────▶ minio  (internal: minio:9000)
   │                                    ├──────────────▶ mailpit (SMTP)
   │                                    └──────────────▶ LLM provider (Gemini / OpenRouter)
   │
   │   presigned URL, signed for the public host localhost:9000
   └──(direct GET — raw files only)──▶ minio  (public: localhost:9000)

Dev tools:  pgweb → postgres (:8081)   ·   Mailpit UI (:8025)   ·   MinIO console (:9001)
```

## 2. Services

| Service | Image / runtime | Host port(s) | Role |
|---|---|---|---|
| `frontend` | Node 22 · Next.js 16.4 (Bun as package manager) | 3000 | UI + `/api/*` rewrite proxy to the backend |
| `backend` | Python 3.12 · FastAPI · uv | 8000 (dev only) | API, triage job worker, sweeper, intelligence pipeline |
| `postgres` | `pgvector/pgvector:0.8.7-pg16` | **5433** → 5432 | Relational data + vector embeddings |
| `minio` | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | 9000 (S3 API), 9001 (console) | Case artifacts + intake uploads |
| `mailpit` | `axllent/mailpit:v1.31.5` | 1025 (SMTP), 8025 (UI) | Captures outbound email in dev (purpose TBD — see CONTEXT §7) |
| `pgweb` | `sosedoff/pgweb:0.17.0` | 8081 (**127.0.0.1 only**) | DB browser for development: no auth, full read/write, so it's never exposed to the network |
| `realtime` | `./realtime` (PartyKit 0.0.115 on Node 22) | **1999** | War-room websockets: one PartyKit room per department. Stateless fan-out; the API publishes persisted events |

All host ports can be changed in `.env`. Postgres defaults to host port 5433 so it doesn't clash with a native Postgres on 5432. Inside the Docker network every service uses its standard port.

## 3. Network & Trust Boundaries

- **Same-origin API.** Browser code only calls `/api/...` on the frontend's origin. That means no CORS, one place to add auth later, and a backend that never has to be public.
- **The backend's port 8000 is published for dev convenience only.** Frontend code must never point at it. Swagger is served at `/api/docs`, so it also works through the proxy.
- **Presigned links are the only direct browser → MinIO path.** They are GET-only, short-lived (≤ 10 min), and generated fresh on each click (never cached client-side beyond their TTL).
- **Signing host ≠ internal host.** The backend talks to `minio:9000` inside the Docker network, but the browser uses `localhost:9000`. SigV4 signs the Host header, so presigned URLs must come from a second MinIO client configured with the **public** endpoint (§15.1).
- **Uploads.** Small intake files can go `/api/triage` → backend (validates type/size) → MinIO. The Next `/api` rewrite **can't carry bodies over 10 MB** (§15.23), so large files must use presigned PUT URLs straight to MinIO.

## 4. Repository Layout

```text
anduin-memory-bank/
├── frontend/                     Next.js 16.4 (TypeScript, App Router, React Query, Axios, Tailwind 4, shadcn/ui)
│   ├── AGENTS.md / CLAUDE.md     Next's agent rules: read node_modules/next/dist/docs before coding
│   ├── eslint.config.mjs         enforces the layering below (no-restricted-imports / fetch)
│   ├── next.config.ts            /api/:path* rewrite → BACKEND_INTERNAL_URL; standalone; Cache Components
│   ├── proxy.ts                  Next 16 Proxy: page-level auth gate (verifies the refresh cookie, default-deny)
│   ├── components.json           shadcn config (Radix base, Nova style, lucide icons)
│   ├── app/                      (app)/ signed-in routes · (auth)/ login + register · providers.tsx · globals.css
│   ├── components/               presentational only: ui/ (shadcn), brand/ (Dejavu kit), shell/ (nav, user menu), auth/, feature folders
│   ├── store/                    React Query hooks (queryKeys.ts, auth.ts, system.ts, …)
│   ├── services/                 one typed function per endpoint (authService.ts, systemService.ts, …)
│   ├── lib/                      axiosClient.ts (only HTTP client + 401→refresh interceptor), accessToken.ts, apiError.ts,
│   │                             sessionCookie.ts + safeRedirect.ts (used by proxy.ts), utils.ts
│   └── types/                    API contract types (mirror backend Pydantic)
├── backend/                      FastAPI (Python 3.12, uv, SQLAlchemy 2.0 async, pgvector)
│   ├── pyproject.toml            deps + ruff + pytest + [tool.alembic] config
│   ├── migrations/               Alembic: env.py, script.py.mako, versions/ (one file per schema change)
│   ├── app/
│   │   ├── main.py               app factory + lifespan (idempotent startup)
│   │   ├── health.py             GET /api/health (database, pgvector version, bucket)
│   │   ├── core/                 infrastructure shared by every module:
│   │   │                           config.py (settings) · db.py (Base, engine, SessionDep) · security.py (Argon2, JWT)
│   │   │                           storage.py (MinIO clients) · migrations.py (Alembic from code: reset / upgrade)
│   │   ├── modules/
│   │   │   ├── auth/             users, refresh tokens: models, schemas, service, router, deps (CurrentUser)
│   │   │   ├── org/              departments
│   │   │   ├── cases/            case records, channel + copilot messages, artifacts, knowledge chunks
│   │   │   ├── vault/            memory vault API, ingest, presigned links (routes TBD)
│   │   │   ├── triage/           (planned) job lifecycle, worker.py, sweeper.py
│   │   │   └── intelligence/     4-step pipeline: service, retrieval, llm_client, prompts, schemas, guard
│   │   ├── seed.py               loads the seed pack → DB + MinIO (idempotent)
│   │   ├── seed_pack.py          reads the seed pack (manifests, channel.txt parser)
│   │   └── seed_pdfs.py          renders seed-pack legal excerpts (*.pdf.md → PDF, deterministic)
│   ├── data/seed_pack/           departments.json, users.json, cases/<CASE-CODE>_<slug>/ (resolved), channels/<slug>/ (open demo channels)
│   └── tests/
├── docker/postgres/              init SQL (CREATE EXTENSION vector)
├── scripts/                      Bun: setup.ts, dev.ts (--refresh-db), db.ts (migrations), docker.ts (helpers + stop/logs/seed/test/lint/reset)
├── docker-compose.yml
├── .env.example                  copied to .env by setup (git-ignored)
├── package.json                  bun run setup / dev / stop / logs / seed / test / lint / reset / db:*
└── README.md · CLAUDE.md · CONTEXT.md · ARCHITECTURE.md · DESIGN.md · PLAN.md (todo)
```

## 5. Frontend

### 5.1 Layers (strict, one direction)

```text
app/**/page.tsx        thin client container: reads params, calls store hooks, wires callbacks
      ↓
store/*.ts             React Query hooks: query keys, polling, cache invalidation
      ↓
services/*Service.ts   one typed function per endpoint, no React
      ↓
lib/axiosClient.ts     baseURL "/api"
```

`components/` is purely presentational: props in, callbacks out. It never imports `store/`, `services/`, or axios.

### 5.2 Data loading & mutations

- **No N+1:** a screen loads in a fixed number of requests (≈ one per pane), never one per row. Rows render from the data their page passes down; endpoints are widened or batched rather than called per item (D23).
- **UI first:** mutations update the cache optimistically, then call the API. On failure they roll back and tell the user (transient errors are retried first), and they re-sync on settle (D24).
- Templates: `.claude/skills/anduin-memory-bank/references/frontend-patterns.md` § Data loading / § Mutations. The backend counterpart (view-shaped endpoints, idempotent writes) is in backend-patterns.md.

### 5.2a Polling

While a triage job is `QUEUED` or `PROCESSING`, its query polls about every 2 s (`refetchInterval`). Polling stops as soon as the job reaches `COMPLETED` or `FAILED`, or the request errors. The job also reports its current pipeline step, so the UI can show real progress ("Retrieving precedents…") instead of a spinner.

### 5.3 Screens (per DESIGN.md — features not final)

| Route | Status | Purpose |
|---|---|---|
| `/` | Built | Redirects to `/workbench` |
| `/login`, `/register` | Built | `(auth)` group: split brand panel + form. Signed-in visitors are redirected to `/workbench` |
| `/workbench` | Frame built | `(app)` group (signed-in only). 3-pane Swiss grid: 01 incoming request · 02 precedent & delta engine · 03 reusable kit & source |
| `/workbench/[jobId]` | Proposed | The same 3 panes filled from a triage job, so results are linkable (polls while the job is active) |
| `/vault` | Proposed | Stats strip (cases · alumni memories · reusable artifacts) + case table |
| `/vault/[caseId]` | Proposed | Case detail: outcome, people (ACTIVE/ALUMNI), artifacts, discussions |
| `/ingest` | Needs sign-off | Ingest Archive: add past cases to the vault (DESIGN.md §8) |

### 5.4 UI system

The visual language is **Dejavu**, Anduin's Swiss grid (DESIGN.md):
- **Components:** shadcn/ui, Radix base, Nova style, in `components/ui/`. Dejavu signature components live in `components/brand/`.
- **Tokens:** every token lives in `app/globals.css`, mapped onto shadcn's semantic roles plus brand and status utilities (`bg-navy`, `bg-surface-2`, `text-reusable`, …).
- **Square, flat, light-only:** radius and shadows are neutralised globally, and there's no dark mode. The `dark:` variant is class-based so shadcn's dark styles never activate from the OS setting.
- **Coding rules:** `.claude/skills/anduin-memory-bank/references/design-system.md`.

### 5.5 Next.js 16.4 specifics

- **Read the bundled docs.** This version is newer than most model training data; `frontend/AGENTS.md` points to `node_modules/next/dist/docs/`.
- **Cache Components + Partial Prefetching are on** (the create-next-app default; both become mandatory in the next major).
  - Consequence: a dynamic segment (`[jobId]`, `[caseId]`) must give its page a Suspense boundary, or `next build` fails with "uncached or runtime data… accessed outside of `<Suspense>`".
  - We use a `loading.tsx` in each dynamic segment, which doubles as the skeleton. Verified: a client page calling `use(params)` fails the build without it and builds as a Partial Prerender with it.
- `params` / `searchParams` are Promises. Client pages unwrap them with `use(params)`.
- Turbopack is the default bundler. Tailwind 4 loads through the `@tailwindcss/turbopack` loader (no PostCSS config). `middleware.ts` is now `proxy.ts`; we don't need one yet.
- **Layouts must always render `{children}`.** Instant-navigation validation flags any page segment a layout doesn't render ("Could not validate … Dropped segment"). The `(app)` auth gate therefore renders the page *hidden* behind the session splash, rather than swapping it out. `export const instant = false` would only exempt navigations *into* the group, and it can't be exported from a Client Component.
- `output: "standalone"` for the production image.
- Rewrites are resolved at **build time** in production builds (they end up in `routes-manifest.json`). Pass `BACKEND_INTERNAL_URL` as a build arg, not only as a runtime env var.

## 6. Backend

### 6.1 Layers

`router` (HTTP only: parse, status codes, dependencies) → `service` (business logic, transactions) → SQLAlchemy models. Each module has its own Pydantic `schemas.py` for I/O.

### 6.2 Modules & dependency direction

```text
triage ──▶ intelligence ──▶ vault ──▶ core
   └───────────┴──────────────┴──▶ auth (CurrentUser) ──▶ core
```

| Module | Owns |
|---|---|
| `auth` | `users`, `refresh_tokens`; register / login / refresh / logout / me; `deps.CurrentUser` for protecting any route |
| `vault` | Historical cases, people, artifacts, knowledge chunks; ingestion (chunk + embed); presigned links |
| `triage` | Intake API, triage job lifecycle (create / get / claim / heartbeat / finish), `worker.py`, `sweeper.py` |
| `intelligence` | The 4-step pipeline, `llm_client`, prompts, LLM contracts, guard. Reads vault through `vault.service`; owns no tables. |

Rules:
- Never import against the arrows.
- Modules call each other through `service.py` only, never through a router.
- Only the owning module writes its tables.
- The pipeline therefore *returns* a validated report plus progress callbacks, and the triage worker persists both.

### 6.3 Startup — idempotent, runs on every container start

1. **Container CMD:** `alembic upgrade head`, then uvicorn. A failed migration stops the container rather than serving a stale schema. The pgvector extension is created by the first migration.
2. **Lifespan:** ensure the MinIO bucket. This is **non-fatal**: a storage outage is logged and reported by `/api/health` instead of crashing the API.
3. **Lifespan:** `sweep_once()` to recover jobs orphaned by a restart. *(Not wired yet: needs the job table.)*
4. **Lifespan:** start the background `worker` and `sweeper` loops (asyncio tasks). *(Not wired yet.)*

On shutdown: cancel the loops and dispose the engine. A job interrupted mid-run stays `PROCESSING`, and the sweeper recovers it.

### 6.3a Schema migrations (Alembic)

- **Migrations own the schema** (`backend/migrations/`); `create_all` is never used. Config lives in `pyproject.toml` `[tool.alembic]`, and `env.py` takes the URL from app settings and the metadata from `app.core.db.Base`.
- **Workflow:**
  1. Change `models.py`.
  2. `bun run db:revision "describe the change"` autogenerates a file in `migrations/versions/`.
  3. **Review it.** Autogenerate misses renames, extensions, data moves, and some type changes.
  4. `bun run db:migrate`.
  5. Commit the model change and the migration together.
- **Hand-written migrations** (extensions, data fixes): `bun run db:revision "…" --empty`.
- **New modules:** add their `models` import to `migrations/env.py`, or autogenerate won't see their tables.
- **Constraint naming:** `Base.metadata` uses a naming convention (`pk_users`, `uq_users_email`, `fk_<table>_<col>_<ref>`, `ix_…`), so constraints can be altered or dropped reliably later.
- **Tidy output:** generated files are run through `ruff format` and `ruff check --fix` by post-write hooks.
- **Guards:** `tests/test_migrations.py` fails if the models drift from the migrations (`alembic check`), and verifies a full downgrade → upgrade round trip.

### 6.4 Triage job lifecycle

```text
 POST /api/triage
        │
        ▼
     QUEUED ──(worker claims: FOR UPDATE SKIP LOCKED)──▶ PROCESSING ──(4 steps, heartbeat per step)──▶ COMPLETED
        ▲                                                    │
        └──(sweeper: heartbeat stale AND attempts < max)─────┤
                                                             └──(error, or attempts exhausted)──────▶ FAILED
```

- **The job record must be able to answer:** status, current step, attempt count, last heartbeat, result payload, error. Field names are TBD with the schema.
- **Worker:** claims one job at a time with `SKIP LOCKED`, which stays safe with multiple uvicorn workers or replicas. Concurrency is bounded (default 2), and the worker heartbeats between pipeline steps.
- **Sweeper:** runs at startup and then about every 30 s. A `PROCESSING` job whose heartbeat is older than ~2 min goes back to `QUEUED` if it has attempts left (max 3); otherwise it becomes `FAILED`.
- **Pipeline steps must be safe to re-run:** result writes overwrite, they never append.
- LLM work **never** runs inside the HTTP request and never as a fire-and-forget in-memory task.

### 6.5 Async hygiene

- The MinIO Python SDK is synchronous. Wrap network calls in `asyncio.to_thread`. Presigning is pure computation once the region is fixed (§15.1).
- Use async LLM clients (`google-genai` `client.aio`, `openai.AsyncOpenAI` for OpenRouter).

## 7. Intelligence Pipeline (4-step delta engine)

| Step | Function | In → Out |
|---|---|---|
| 1. Intake extraction | `extract_brief_metadata` | raw text/files → `IntakeBrief` (client_type, jurisdiction, fund_structure, key_requirements[], search_query) |
| 2. Hybrid retrieval | `retrieve_similar_cases` | brief → embed → pgvector cosine top-K chunks → metadata boost → per-case aggregation → **Top 3** + similarity % + retrieved context bundle |
| 3. Structured delta | `compute_case_delta` | incoming request + top match context → `complete_json()` → `CaseComparisonReport` (REUSABLE / MODIFIED / NET_NEW items) |
| 4. Guard | `guard.validate_report` | report + retrieved context → repaired report + guard warnings, which the triage worker then persists |

Invariants:
- Code — not the LLM — sets `historical_case_id` and `similarity_score`.
- Every cited artifact or chunk ID must exist in that case's retrieved context; anything else is stripped and logged as a guard warning.

Full contracts, prompt rules, and retry policy: `.claude/skills/anduin-memory-bank/references/intelligence-pipeline.md`.

## 8. Object Storage (proposed)

There is one private bucket (`MINIO_BUCKET`, default `memory-bank`), and objects are only reachable through presigned GET links.

| Prefix | Contents |
|---|---|
| `cases/{case_slug}/artifacts/{filename}` | Historical artifacts (schemas, scripts, post-mortems, Slack exports, PDFs) |
| `intake/{job_id}/{filename}` | Files uploaded with an incoming request |

## 9. Data Model

### 9.1 Built: auth tables (migration `create users and refresh tokens`)

| Table | Columns | Notes |
|---|---|---|
| `users` | `id` uuid PK · `email` varchar(320) **unique** · `name` varchar(100) · `password_hash` varchar(255) · `is_active` bool (default true) · `created_at`, `updated_at` timestamptz | Email is stored lowercased, so uniqueness is case-insensitive. The hash is Argon2id |
| `refresh_tokens` | `id` uuid PK (= the JWT's `jti`) · `user_id` → `users.id` **ON DELETE CASCADE** (indexed) · `family_id` uuid (indexed) · `expires_at` · `created_at` · `revoked_at` (null = live) · `replaced_by_id` uuid | One row per issued refresh token. `family_id` = one login session. Rotation sets `revoked_at` + `replaced_by_id` on the old row |

Expired and revoked token rows are not cleaned up yet. Add a periodic purge (e.g. in the sweeper) once volume matters.

### 9.2 Built: domain tables (migration `add departments, cases, and knowledge chunks`)

| Table | Module | Key columns | Notes |
|---|---|---|---|
| `departments` | `org` | `id` varchar PK (`CLIENT_OPERATIONS`, `LEGAL_COMPLIANCE`, `SALES_SOLUTIONS`, `CUSTOMER_SUCCESS`, `ENGINEERING_DATA`) · `code` unique · `name` · `description` · `accent_color` · `agent_system_hint` | Every user sees every department (no RBAC walls in the MVP); `agent_system_hint` scopes the agent's persona |
| `users` (extended) | `auth` | + `primary_department_id` → departments (SET NULL) · `role` · `job_title` · `avatar_initials` · `tenure_note` · `departed_at` · `is_active` indexed | `is_active = false` = ALUMNI: can't sign in, history stays attributed. Seeded colleagues get `UNUSABLE_PASSWORD` |
| `case_records` | `cases` | `case_code` unique (`CASE-2025-014`) · `channel_slug` unique · `department_id` · `secondary_department_ids` jsonb · `status` (`OPEN` \| `RESOLVED`, CHECK) · `created_by_user_id` · `lead_resolver_user_id` · `initial_request_brief` · `context_tags` jsonb · `comparison_results` jsonb · memory fields (`summary`, `how_it_went`, `resolution_steps`, `pitfalls`, `duration_days`, `resolved_at`) | One row for the case's whole life: OPEN channel → RESOLVED memory. CHECK ties `resolved_at` to `status`. Analysis/summarisation progress will live in a job table, not in `status` |
| `case_artifacts` | `cases` | `case_id` (CASCADE) · `file_name` (unique per case) · `file_type` · `content_type` · `size_bytes` · `is_reusable` · `minio_object_key` unique · `preview_text` | Files in MinIO at `cases/{channel_slug}/artifacts/{file}` |
| `channel_messages` | `cases` | `seq` identity (stable order) · `case_id` · `user_id` · `content` · `attached_artifact_id` · `is_resolution_milestone` | Human team discussion |
| ↳ mentions & Dejavu | `cases` | `channel_messages.mentioned_user_ids` (JSONB) · `is_agent` | `@Name` in the case channel (composer autocomplete) stores the ids and joins them to the case; alumni/unknown ids are dropped. `@Dejavu` queues a COPILOT job with `reply_in_channel`: the answer is posted as an `is_agent` message whose id is the job id (a retried job posts once) and published over PartyKit |
| `case_members` | `cases` | `case_id` + `user_id` (PK) · `role` (`LEAD` \| `MEMBER`, CHECK) · `joined_at` | Owner is LEAD; creator and anyone who posts join automatically; others are added from the People tab (`PUT/DELETE /api/cases/{id}/members/{user_id}`, idempotent). Alumni can't be added, the owner can't be removed |
| `copilot_messages` | `cases` | `seq` · `case_id` · `user_id` · `role` (`user` \| `assistant`, CHECK) · `content` · `cited_case_ids` · `cited_artifact_ids` | Citations are set by code from retrieved context, never by the LLM |
| `knowledge_chunks` | `cases` | `case_id` · `department_id` · `artifact_id` / `message_id` (source) · `chunk_type` (CHECK) · `reference_label` · `content` · `embedding vector(EMBEDDING_DIM)` | HNSW cosine index (`m=16`, `ef_construction=64`). Not populated yet: embedding lands with the intelligence pipeline |

| `departments.lead_user_id` · `users.active_department_id` | `org` · `auth` | lead → users (SET NULL); the header switcher's saved view (null = All Departments) | The lead is always a member of the department's war room |
| `rooms` | `rooms` | `department_id` PK · `pinned_case_id` | One war room per department, created on first use |
| `room_members` | `rooms` | (`department_id`, `user_id`) PK · `role` (`LEAD` \| `MEMBER`) | Default members: lead + active people of that department. Posting joins; the lead can't be removed; alumni can't join |
| `room_messages` | `rooms` | `id` (client-generated, idempotent send) · `seq` identity (polling cursor) · `department_id` · `user_id` · `content` · `tagged_case_codes` jsonb · `attached_artifact_id` · `is_milestone` | `#CASE-YYYY-NNN` tags are validated by code on write |
| `room_reads` | `rooms` | (`department_id`, `user_id`) PK · `last_read_seq` | Unread = messages by others above the marker; the marker only moves forward |

- **Realtime (PartyKit, `realtime/party/server.ts`):** PartyKit room id = department id. After a room write commits, the API POSTs `message.created` / `room.changed` to `http://realtime:1999/parties/main/{dept}` with the shared `x-realtime-secret` (`app/core/realtime.py`, best effort, 1 s timeout). Browsers connect with `partysocket` and send `{type: "auth", token, user}` as the first frame; the room verifies the HS256 access token (same `JWT_SECRET`) and closes unauthenticated sockets after 5 s (code 4001). Rooms also relay presence and typing. Tokens never go in the socket URL.
- **Workbench (replaces the separate War Room), three routes:** `/workbench` hub: 01 new-case intake (demo presets, customer, project/fund, source type, brief, file dropzone, severity, people to resolve it → `member_ids` on create) · 02 department channels (one per department, unread counts) · 03 active case rooms (open cases for the header department). `/workbench/cases/[caseId]`: case details (editable) on the left · case header + tabs **Case channel** (default) / **Precedent & delta** / **Memory copilot** / **People** (case members, add/remove) (+ the Complete & save to memory review, `?review=1`) · **Reusable kit** on the right (preview, "Use in case" posts the file into the channel). `/workbench/rooms/[departmentId]`: the department channel + members. On ≥1024px the side panes are resizable and collapsible (`react-resizable-panels` via `components/workspace/PaneLayout` + `lib/usePanels`, sizes saved in localStorage); narrower screens use drawers. `/war-room` and old `/workbench?case=<id>` links redirect.
- **Background file conversion (EXTRACT job):** `POST /api/cases/{id}/files` (triage router) stores the file in MinIO and returns at once with `text_status=PENDING` (≤ 50 MB); one live EXTRACT job per case converts every pending file with MarkItDown off the event loop (`storage.read_object` + `documents.extract_text`, ≤ 500k chars), sets `READY`/`UNREADABLE`, re-checks for files uploaded meanwhile, and publishes a `threads` change. ANALYZE and SUMMARIZE call `extract_pending` first, so they never read a half-processed case; the thread view polls every 4 s while a file is pending. Embeddings are sent in batches of 64 and at most 120 chunks (~180k chars) per file are indexed. Long threads (> 60k chars) are condensed into line-referenced notes per segment (≤ 40k chars, split on message boundaries, 4 in parallel) before the memory record is drafted; citations still resolve against the full transcript.
- **Memory curator (Complete & save to memory, the SUMMARIZE job + `intelligence/curator.py`):** Dejavu first asks for the outcome (`RESOLVED | WORKAROUND | PARTIAL | ESCALATED | WITHDRAWN`), the final output and the final deliverable files (`POST /resolve` job input). Files can be dropped right there: tagged `CLIENT_APPROVAL` (sign-off email/PDF) or `FINAL_OUTPUT`, uploaded to the case, and made deliverables; their MarkItDown text goes into the summarizer's `<outcome>` block. With a file attached the typed final output is optional. Client approvals are evidence, never auto-suggested as reusable. The summarizer drafts the record from the case chat with the outcome as the ending; the curator then suggests reusable files (deliverables always offered; names checked against the case's files) and checks the record against the 10 nearest older resolved chunks for real contradictions (case codes checked against what was retrieved). Commit (`CommitIn.outcome`, `final_output`, `reusable_file_ids` as explicit state) stores `case_records.outcome/final_output`, sets `case_artifacts.is_reusable`, resolves the case into the Knowledge Base and re-indexes it with the outcome in the summary chunk. The vault card and case details show the outcome.
- **Triage agent (the ANALYZE job, `intelligence/triage_agent.py`):** (1) intake brief + files (MarkItDown → Markdown in `core/documents.extract_text`) are chunked and embedded into `knowledge_chunks` (open cases too, lazily for any open case not indexed yet); (2) `analyzer.rank_precedents` picks the top 3 by code; (3) a tool-calling loop (≤ 8 calls, `AGENT_MODEL`, default `google/gemini-2.5-flash` via OpenRouter) investigates with `search_knowledge_vault`, `check_active_duplicates`, `get_case_details`, `find_people` (alumni → active handoff) and `estimate_effort`; skipped sections are filled by automatic checks; (4) the delta (`analyzer.compare`) and the `TriageReportDraft` are written in parallel; (5) `guard_triage` keeps only people/cases that tools returned, takes effort numbers from code and raises risk to HIGH when the deadline is shorter than the precedents' median. Each step is appended to `case_jobs.trace` (live investigation screen, polled); the report is stored in `case_records.triage_report` and shown above the delta matrix. Falls back to scripted checks + a deterministic report if the model is unavailable.
- **ANALYZE job** (`POST /api/cases/{id}/analyze`): incoming request (fields + uploaded file text) → embedding → best chunk per RESOLVED case → score = cosine % + metadata boost (3 per precedent tag value found in the request, 2 for a shared department, max 10, total ≤ 99), set by code → top 3 → one LLM call (`CaseComparisonReport`: how it went, pitfalls, delta items) → `analyzer.guard_report` (only retrieved cases, retrieval scores and order, unknown files removed, NET_NEW kept under the top match) → `case_records.comparison_results` (same shape as the seed pack's `comparisonResults`, plus `scoreBreakdown`). The thread view returns enriched precedents (lead, duration, delta, files with uploaders) for the delta tab and the kit.
- **COPILOT job** (`GET|POST /api/cases/{id}/copilot`; also `@Dejavu` in the case channel, which replies in the channel): the copilot always reads the case channel as a numbered transcript. the question is stored as a `copilot_messages` row (client id), a COPILOT job (input = question) retrieves the case's precedents + 8 nearest memory chunks, one LLM call → `CopilotAnswerDraft`; case codes it cites are checked against what was retrieved, files cited by name are resolved to ids by code. Several questions may queue (the one-live-job rule exempts COPILOT).
- **Files:** `POST /api/cases/{id}/files` (multipart, ≤ 15 MB, PDF/CSV/MD/TXT/JSON/EML/DOCX/XLSX) stores to MinIO and extracts text (`core/documents.py`, pypdf for PDFs) into `preview_text`, which feeds analysis, the summarizer and indexing. Same file name = replaced. Thread messages can attach any case's file (`attached_artifact_id`).
- **Case intake & details:** `case_records` carries `client_name`, `severity` (`CRITICAL | HIGH | MEDIUM | LOW`, CHECK) and `due_date`; `lead_resolver_user_id` is the case **owner** while open. `POST /api/cases` takes the full intake (customer, title, problem & context, severity, deadline, owner (defaults to the creator; must be active), up to 8 context tags, involved departments). `PATCH /api/cases/{id}` edits an OPEN case's details (only the fields sent; returns the full thread view; publishes to the thread and every department involved before or after). Customer, severity and deadline also go into the summarizer prompt and the indexed `CASE_SUMMARY` chunk.
- **Case threads (sub-chats):** every OPEN case is a thread (`channel_messages`) listed under its owning department and every department in `secondary_department_ids` (`RoomView.threads`). `POST /api/cases` opens one (client-generated id, server-assigned next `CASE-YYYY-NNN`) · `GET /api/cases/{id}/thread` (case, precedents, participants, latest messages) · `GET …/thread/messages?after_seq=` · `POST …/thread/messages` (idempotent; RESOLVED threads are read-only). Each thread is its own PartyKit room `case-<case id>`; thread writes also publish `room.changed {reason: "threads"}` to the involved department rooms. The thread is the unit the AI summarizer will turn into a Case Memory Record.
- **Resolve & Commit to Memory (`triage` + `intelligence`):** `case_jobs` (`id` client-generated · `case_id` · `kind` SUMMARIZE | INDEX · `status` QUEUED → PROCESSING → COMPLETED | FAILED · `step` · `attempts` · `heartbeat_at` · `result` jsonb · `error`; partial unique index = one live job per case and kind). The worker and sweeper run in the API lifespan (`WORKER_ENABLED`), claiming with `FOR UPDATE SKIP LOCKED`.
  1. `POST /api/cases/{id}/resolve {job_id}` → SUMMARIZE: the thread becomes a numbered transcript (the `Chat #L<n>` citation surface) plus war-room messages tagging the case (chosen by code) and the case's file names → `llm_client.complete_json` → `CaseMemoryDraft` (Pydantic) → `guard_memory` (drops unverifiable references, sets `authorId`/`messageId` from the cited line; the LLM never sets IDs). The draft + guard warnings + provider label land on `job.result`.
  2. The UI polls `GET /api/cases/{id}/jobs` every 2 s and shows the steps, then an editable review form.
  3. `POST /api/cases/{id}/commit` (the reviewed draft, re-guarded server-side) → case RESOLVED (thread read-only, `duration_days` computed) and an INDEX job: `CASE_SUMMARY`, `RESOLUTION_PLAYBOOK`, `CHANNEL_DISCUSSION` (6-message windows) and `ARTIFACT_CONTENT` chunks → embeddings → `knowledge_chunks` (replaced, so re-indexing is idempotent).
  - Failures: provider 429/5xx/timeouts back off 1→2→4 s inside the call; an invalid JSON answer gets one repair attempt; the job is requeued until `JOB_MAX_ATTEMPTS`, except permanent errors (missing key/model, rejected request, empty thread) which fail at once. Stalled PROCESSING jobs are requeued by the sweeper.
  - Providers (`intelligence/llm_client.py`): `openrouter` (OpenAI-compatible chat completions with JSON-schema response format, JSON-mode fallback; embeddings via `/embeddings`), `gemini` (REST, key in the `x-goog-api-key` header), `fake` (deterministic). Configure with `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`.
- **RAG retrieval:** `GET /api/memory/search?q=&department_id=&limit=` embeds the query and ranks `knowledge_chunks` by cosine distance (HNSW), grouped by case; similarity % = 1 − distance, computed by code. `bun run reindex` queues INDEX jobs for every resolved case (after changing the embedding model); `bun run seed` queues them for resolved cases without chunks. Current dev config: summarizer `anthropic/claude-sonnet-5.5` and embeddings `openai/text-embedding-3-small` @ 768 dims, both via OpenRouter. Pure vector ranking only so far; the planned metadata boost (jurisdiction, structure, investor type) arrives with the ANALYZE job.
- **War Room API:** `GET /api/rooms` (summaries + unread) · `GET /api/rooms/people` · `GET /api/rooms/{dept}` (whole screen in one request) · `GET /api/rooms/{dept}/messages?after_seq=` (polled every 3 s) · `POST …/messages` · `PUT|DELETE …/members/{user_id}` · `PUT …/pinned-case` · `PUT …/read`.
- **JSONB shapes** (camelCase keys, as in the seed pack): `pitfalls[] = {warning, severity, reference, authorId, messageId}`; `comparison_results[] = {caseCode, caseId, similarityScore, howPastCaseWent, pitfallWarnings[], deltaItems[{category, pastApproach, currentRequirement, status, actionRecommendation, sourceArtifact, sourceArtifactId}]}`.
- **Module dependencies:** `org` imports only `core`; `auth.models` references `org.Department`; `cases` imports `auth.models` and `org.models`. Relationships are `lazy="raise"`.
- **Still to design:** the job table (§6.4) for ANALYZE / SUMMARIZE runs.

## 10. API Surface

All routes live under `/api` on the backend; the frontend rewrite forwards the path unchanged.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | **Implemented.** `200 {status:"ok", database, pgvector, storage}`, or `503 {status:"degraded", …}` |
| POST | `/api/auth/register` | **Implemented.** `{email, name, password, confirm_password}` → `201 AuthOut` + refresh cookie. `409` if the email is taken, `422` field errors |
| POST | `/api/auth/login` | **Implemented.** `{email, password}` → `200 AuthOut` + refresh cookie. `401 "Invalid email or password"` (same for unknown email) |
| POST | `/api/auth/refresh` | **Implemented.** Refresh cookie → rotated cookie + `200 AuthOut`. `409 refresh_token_rotated` (benign two-tab race: retry once). `401` clears the cookie |
| POST | `/api/auth/logout` | **Implemented.** Revokes the cookie's whole session (token family) and clears the cookie. Always `204` |
| GET | `/api/auth/me` | **Implemented.** Bearer access token → current user |
| POST | `/api/triage` | Multipart (`text` and/or `files[]`) → `202 { job_id }` |
| GET | `/api/triage/{job_id}` | Status, current step, result, error |
| GET | `/api/vault/cases` | List / browse historical cases (filters TBD) |
| GET | `/api/vault/cases/{case_id}` | Case detail: outcome, people, artifacts |
| GET | `/api/vault/artifacts/{artifact_id}/link?disposition=inline\|attachment` | Fresh presigned URL |
| GET | `/api/docs`, `/api/openapi.json` | Swagger / OpenAPI (dev). The "Authorize" button accepts the bearer token |

Proposed routes (triage, vault) will require `CurrentUser`. `AuthOut` = `{access_token, token_type: "bearer", expires_in, user: {id, email, name, created_at}}`.

### 10a. Authentication flow

```text
register / login ──▶ 200 AuthOut {access_token (15 min)} + Set-Cookie dejavu_refresh (7 days, httpOnly, SameSite=Lax, Path=/)
page request ──▶ frontend/proxy.ts verifies the cookie (signature, expiry, type) ──▶ render, or 307 /login?next=…
API call ──▶ Authorization: Bearer <access_token> ──▶ deps.CurrentUser (JWT verified, type=access, user active)
401 on an API call ──▶ axios interceptor ──▶ POST /api/auth/refresh (cookie) ──▶ new access token + rotated cookie ──▶ retry once
page reload ──▶ useSession() ──▶ POST /api/auth/refresh ──▶ session restored (or 401 → /login)
logout ──▶ POST /api/auth/logout ──▶ whole token family revoked, cookie cleared
```

- **Where tokens live.**
  - The access token is held in browser memory only (`lib/accessToken.ts`), never in localStorage.
  - The refresh token is an **httpOnly** cookie, so JavaScript can't read it (verified).
  - The cookie's path is `/`, so page requests carry it to the Next.js proxy.
  - `SameSite=Lax`:
    - it's sent on top-level navigations from other sites, so a Dejavu link opened from Slack or email keeps the session;
    - it's never sent on cross-site POSTs, so `/refresh` and `/logout` stay CSRF-safe;
    - all other API routes authenticate with the bearer token, not the cookie.
- **Rotation + reuse detection.**
  - Every refresh issues a new refresh token and revokes the old one.
  - If an *already-revoked* token is presented after the 30 s grace window, the whole session (family) is revoked, on the assumption it was stolen.
  - Within the grace window, a replay is treated as two tabs racing: `409`, and the client retries with the newer cookie.
  - Concurrent refreshes of one token are serialised with `SELECT … FOR UPDATE`.
- **Passwords.** Argon2id (pwdlib). Hashing runs in a thread so it doesn't block the event loop. A dummy verify for unknown emails equalises response timing.
- **JWTs.** PyJWT, HS256, signed with `JWT_SECRET` (generated into `.env` by `bun run setup` / `bun run dev`). Claims: `sub`, `type`, `jti`, `iat`, `exp`. A refresh token is rejected as an access token, and vice versa.
- **Page gate — `frontend/proxy.ts` (Next 16 Proxy, Node runtime).**
  - Runs on every page request before render. It is **default-deny**: every page needs a valid refresh cookie except `/login` and `/register`, which instead bounce signed-in users to `?next=` or `/workbench`.
  - Signed-out visitors get `307 /login?next=<path+query>`, and an invalid cookie is deleted.
  - The check is **optimistic**, per the Next.js guidance (proxy runs on every route, including prefetches): `jose` verifies the HS256 signature with the backend's `JWT_SECRET`, plus expiry and `type=refresh`. There is **no DB lookup**, so a revoked-but-unexpired token passes the proxy.
  - Revocation is still enforced. The `(app)` layout restores the session via `/api/auth/refresh`, and a 401 there clears the cookie and redirects to `/login`.
  - **Authorisation is enforced by the API** (`CurrentUser` on every route), never by the proxy or the UI.
  - The matcher skips `/api/*`, `/_next/*`, dev-overlay endpoints, and any path with a file extension.
  - `?next=` is sanitised by `lib/safeRedirect.ts`: it's resolved with the URL parser and must stay same-origin, which blocks `//evil.com` and `/\t/evil.com`-style open redirects.
- **Fail loudly on misconfiguration.** If the frontend has no `JWT_SECRET`, the proxy throws (500 plus a log line) instead of treating everyone as signed out. If the secret differs from the backend's, every login bounces back to `/login`, and the proxy logs "invalid signature — is JWT_SECRET identical…".
- **Not built (yet):** rate limiting on login/register, email verification, password reset, "sign out everywhere", and purging old token rows.

## 11. Configuration

There is one root `.env`, created from `.env.example` by `bun run setup` and git-ignored. Compose reads it both for `${VAR}` interpolation and as the backend's `env_file`. Container-network values (`DATABASE_URL`, `MINIO_ENDPOINT`, …) are composed in `docker-compose.yml`, so `.env` only holds credentials, LLM settings, and host ports.

| Variable | Used by | Example / default | Notes |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres, backend, pgweb | `memory` / `memory` / `memory_bank` | Dev-only credentials |
| `BACKEND_INTERNAL_URL` | frontend | `http://backend:8000` | Set in compose; rewrite target; baked in at `next build` |
| `DATABASE_URL` | backend | `postgresql+asyncpg://…@postgres:5432/…` | Set in compose from the `POSTGRES_*` vars |
| `MINIO_ENDPOINT` | backend | `minio:9000` | Set in compose; internal reads/writes |
| `MINIO_PUBLIC_ENDPOINT` | backend | `localhost:${MINIO_API_PORT}` | Set in compose; host the browser uses — signing only |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | backend, minio | — | |
| `MINIO_BUCKET` / `MINIO_SECURE` | backend | `memory-bank` / `false` | |
| `PRESIGN_TTL_SECONDS` | backend | `600` | |
| `LLM_PROVIDER` / `LLM_MODEL` | backend | `gemini` \| `openrouter` \| `fake` | Model id is provider-specific |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIM` | backend | `gemini` / `gemini-embedding-001` / `768` | Changing model or dim ⇒ re-embed everything |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEY` | backend | — | Never commit; `.env` is git-ignored |
| `SMTP_HOST` / `SMTP_PORT` | backend | `mailpit` / `1025` | |
| `JWT_SECRET` | backend **and frontend** | 64 hex chars | Generated into `.env` by `bun run setup` / `bun run dev` when empty. Min 32 chars, enforced at startup. Compose passes the same value to both. The frontend reads it at request time in `proxy.ts` (not baked into the build) |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | backend | `15` / `7` | |
| `REFRESH_COOKIE_SECURE` | backend | `false` | Set `true` whenever served over HTTPS |
| `JOB_MAX_ATTEMPTS` / `JOB_STALE_AFTER_SECONDS` / `SWEEPER_INTERVAL_SECONDS` | backend | `3` / `120` / `30` | Added with the job worker |
| `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `PGWEB_PORT` | compose | `3000`, `8000`, `5433`, `9000`, `9001`, `1025`, `8025`, `8081` | Host-side ports only |

## 12. Developer Workflow

| Command | Does |
|---|---|
| `bun run setup` | Check Docker, sync `.env` with `.env.example` (generates `JWT_SECRET`), install host deps for editor support, build images, start the stack, wait until healthy |
| `bun run dev` | Sync `.env`, `up -d --build`, wait for health, then follow backend + frontend logs. Ctrl-C stops following; containers keep running. Migrations apply on backend start |
| `bun run dev --refresh-db` | As above, plus `db:reset` (wipe + re-apply every migration) and `python -m app.seed` |
| `bun run db:revision "msg" [--empty]` | Autogenerate a migration from the models (or a blank one) into `backend/migrations/versions/` |
| `bun run db:migrate [rev]` / `db:downgrade [rev]` | `alembic upgrade head` / `alembic downgrade -1` (or to `rev`) |
| `bun run db:current` / `db:history` / `db:check` | Where the DB is / all revisions / fail if models drift from migrations |
| `bun run db:reset [--yes]` | Wipe the dev DB's public schema and re-apply every migration (asks first) |
| `bun run stop` / `bun run logs [svc]` | Stop containers / follow logs |
| `bun run seed` | `docker compose exec backend python -m app.seed` |
| `bun run seed:pdfs [file.pdf.md]` | Re-render seed-pack PDFs from their `*.pdf.md` sources (`python -m app.seed_pdfs`) |
| `bun run test [pytest args]` | `docker compose exec backend pytest …` — note: `bun run test`, **not** `bun test` (Bun's built-in runner) |
| `bun run lint` | Frontend ESLint (host) + backend `ruff check` (container) |
| `bun run reset` | `docker compose down --volumes` after a y/N prompt — **deletes DB and MinIO volumes** |

Container dev notes:
- **Backend:** `./backend` is bind-mounted at `/app`. The venv lives at `/opt/venv` in the image (`UV_PROJECT_ENVIRONMENT`) and is on `PATH`, so commands run as plain `python` / `pytest`, and the macOS host `.venv` never shadows the Linux one.
  - After changing Python deps (`uv add …`), run `bun run dev` to rebuild.
- **Frontend:** `./frontend` is bind-mounted, with anonymous volumes for `node_modules` and `.next`.
  - `bun run dev` passes `--renew-anon-volumes`, so dependency changes are picked up on the next start.
- **Hot reload:** verified for both apps through the bind mounts.
- **Named volumes:** `pgdata`, `miniodata`.

## 13. Testing Strategy

- `pytest` inside the backend container, with `LLM_PROVIDER=fake` and `EMBEDDING_PROVIDER=fake` (deterministic, no API keys).
- **Test database:** tests run against `memory_bank_test`, created on demand. Its schema is rebuilt from the migrations once per run, and tables are truncated before each test (`tests/conftest.py`). Dev data is never touched.
- **Existing tests (13):**
  - `test_auth.py` — register, duplicate email, validation, login, rotation, two-tab race, reuse → session revoked, logout, token-type checks;
  - `test_migrations.py` — models ↔ migrations in sync, plus a downgrade/upgrade round trip;
  - `test_health.py`;
  - `test_storage.py` — presigned URLs are signed for the browser host.
- Starlette's TestClient uses `httpx2` (plain `httpx` is deprecated there).
- Must-have tests:
  - the guard strips foreign artifact IDs and overwrites the score;
  - the sweeper requeues stale jobs and fails them after max attempts;
  - the pipeline runs end-to-end on the fake provider;
  - *(opt-in, real embeddings)* the demo trigger ranks the Cayman FATCA case #1.

## 14. Architecture Decisions

| # | Decision | Status | Why |
|---|---|---|---|
| D1 | Monorepo; everything in Docker Compose; root `bun` scripts | Accepted | Brief |
| D2 | Browser → backend only via the Next `/api` rewrite; exceptions: presigned MinIO GETs, and the PartyKit war-room websocket (ws://localhost:REALTIME_PORT, authenticated in-band) | Accepted | Brief; same-origin, no CORS |
| D3 | FastAPI routes mounted under `/api`; the rewrite forwards the path unchanged | Proposed | One URL shape everywhere; Swagger reachable through the proxy |
| D4 | Async SQLAlchemy 2.0 + asyncpg | Proposed | Matches async FastAPI + async LLM I/O |
| D5 | Alembic migrations own the schema (config in `pyproject.toml`); the container runs `upgrade head` on start; `create_all` is never used | Accepted | Tables now exist (auth). Changes must apply to existing DBs, not just fresh ones |
| D6 | Postgres as the job queue (`SKIP LOCKED`) + in-process worker & sweeper | Proposed | No Redis/Celery; state survives restarts |
| D7 | Job states `QUEUED → PROCESSING → COMPLETED \| FAILED` | Proposed | Unifies the brief's `PENDING` vs `QUEUED` wording |
| D8 | Provider-agnostic `llm_client` (`gemini` / `openrouter` / `fake`) | Proposed | Swap models freely; deterministic tests |
| D9 | Embeddings: one model + dim for the whole corpus, cosine distance | Proposed | `vector` columns have a fixed dimension |
| D10 | The LLM never sets IDs or scores; code overwrites them after parsing | Proposed | Kills a whole class of hallucinations |
| D11 | Two MinIO clients: internal + public signer | Accepted | Required for presigned links to work from the browser |
| D12 | Job progress polls (~2 s). War rooms use PartyKit websockets, with polling kept as a fallback (3 s while offline, 30 s while live) | Accepted | Chat needs push; the DB stays the source of truth, so a realtime outage only delays updates |
| D13 | The pipeline returns results; the triage worker persists them | Proposed | Keeps `intelligence` free of table writes (dependency direction) |
| D14 | Object storage runs `pgsty/minio` (community MinIO build), pinned by release tag | Accepted | Official `minio/minio` images are gone from Docker Hub and Quay. S3 API and SDK are unchanged |
| D15 | Keep Next's Cache Components + Partial Prefetching on; dynamic segments ship a `loading.tsx` | Accepted | create-next-app default; mandatory in the next major |
| D16 | Storage bootstrap is non-fatal at startup; the database is fatal | Accepted | A MinIO outage shouldn't hang the whole API (§15.12) |
| D17 | Bun is the package manager only; Next.js runs on Node 22 | Accepted | Cache Components requires the Node.js runtime |
| D18 | UI kit: shadcn/ui 4.x, Radix base, Nova style (Lucide + Geist); `cn` package replaces clsx + tailwind-merge | Accepted | Radix has the most mature API/docs; Nova matches our existing Geist fonts. `cn` is shadcn's own drop-in |
| D19 | Dejavu theme: Anduin palette mapped onto shadcn roles; square + flat enforced globally; light only | Accepted | DESIGN.md. Global enforcement keeps future `shadcn add` components on-brand without hand edits |
| D20 | `/` redirects to `/workbench`; job results at `/workbench/[jobId]` | Proposed | Matches DESIGN.md routes; results stay linkable |
| D21 | Auth: short-lived JWT access token (memory) + rotating, DB-backed refresh token (httpOnly cookie, `Path=/`, `SameSite=Lax`) with family revocation and reuse detection; Next.js `proxy.ts` gates pages optimistically on that cookie | Accepted | Revocable sessions without server-side session lookups on every request; tokens unreadable by injected scripts |
| D22 | `app/core/` holds shared infrastructure (config, db, security, storage, migrations); domain modules live in `app/modules/` | Accepted | Team convention |
| D23 | No N+1 fetching: a screen loads in a fixed number of requests (≈ one per pane); the API serves view-shaped endpoints built with a fixed number of SQL queries (`selectinload`, aggregates, `IN` batches; relationships `lazy="raise"`) | Accepted | Snappy screens regardless of row count; one round trip through the Next proxy instead of N |
| D24 | Optimistic UI by default: update the React Query cache first, send the request, roll back + notify on failure (transient errors retried first), re-sync on settle. Writes are idempotent (explicit-state PUT/PATCH, tolerant DELETE, client-generated UUIDs on create) | Accepted | The workbench must feel instant; idempotency makes retries safe. Exceptions: auth, server-computed results (LLM, scores, presigned URLs), irreversible actions |

## 15. Known Gotchas

1. **`SignatureDoesNotMatch` on presigned links** happens when the URL is signed for `minio:9000` but opened at `localhost:9000`. Sign with a client configured for `MINIO_PUBLIC_ENDPOINT` and an explicit `region="us-east-1"`. Without the region, the SDK looks up the bucket location over the network, which fails from inside the container.
2. **Production rewrites are build-time.** Set `BACKEND_INTERNAL_URL` when running `next build`.
3. **The rewrite proxy has a timeout** (`experimental.proxyTimeout`). Never make a long synchronous LLM call behind `/api` — that's why we have jobs.
4. **`axiosClient` uses a relative `baseURL`,** so services run only in the browser. Don't call them from Server Components.
5. **`params` is a Promise** in Next.js 16 pages and layouts.
6. **Autogenerate only sees imported models.** `migrations/env.py` must import every module's `models.py`, or new tables won't appear in the generated migration.
7. **Always review autogenerated migrations.** Alembic can't detect renames (it emits drop + add, losing data), extensions, or data moves, and its type-change detection is limited. `bun run test` fails if the models and migrations drift apart.
8. **pgvector indexes must match the operator.** `cosine_distance` (`<=>`) needs an index built with `vector_cosine_ops`. HNSW on `vector` supports at most 2,000 dimensions.
9. **The MinIO SDK blocks.** Network calls go through `asyncio.to_thread`.
10. **`minio/minio` no longer exists on Docker Hub,** and Quay has no tags. Use the pinned `pgsty/minio` release (D14). A locally cached `minio/minio:latest` hides this until a teammate tries to pull.
11. **Raw cosine similarities cluster** (often 0.6–0.85). Decide how `% Match` is displayed before the demo.
12. **The MinIO SDK retries with backoff by default.** A call to a down MinIO takes about 6 s to fail. Under `uvicorn --reload`, a crash during startup leaves the reloader holding the port, so requests hang instead of failing fast. Health probes use a separate no-retry client with a 1–2 s timeout, and bucket bootstrap is non-fatal (D16).
13. **Dynamic routes need a `loading.tsx`** under Cache Components, or `next build` fails (§5.5). `next dev` is more forgiving, so always run `next build` before you call a route done.
14. **`usePathname` in the layout suspends** on any route with an unknown dynamic param (Cache Components). `RoutedTopNav` is therefore wrapped in `<Suspense>`, with a static `TopNav` as the fallback. Keep the wrapper. Verified with a dynamic probe route.
15. **The repo-root `bun.lock` confuses Next's root detection.** It makes Next treat the monorepo as the workspace, and local standalone output nests under `.next/standalone/frontend/`. `next.config.ts` pins `turbopack.root` and `outputFileTracingRoot` to `frontend/`.
16. **New frontend dependencies need a container refresh.** After `bun add` or `shadcn add`, run `bun run dev` (rebuild + `--renew-anon-volumes`). The running container keeps its old `node_modules` volume until then.
17. **`[browser] …` lines in the frontend container log** are browser console output forwarded by Next 16. An old tab replays stale "Module not found" errors after a restart, so reopen the tab before you debug those.
18. **Don't re-run `shadcn init`.** It overwrites `globals.css` with a generic theme, and its generated `--font-sans: var(--font-sans)` refers to itself.
19. **Deleting a route can break the next local `next build`.** Stale generated route types (`.next/dev/types/validator.ts`) still reference it ("Cannot find module …/page.js"). Fix with `rm -rf frontend/.next` and rebuild.
20. **Dev server 500 with `ENOENT … .next/dev/routes-manifest.json`.** This happened once, after layouts were swapped in a route group mid-session. Recover with `bun run dev`, which renews the frontend's `.next` volume.
21. **The email validator rejects reserved TLDs** (`.test`, `.local`, `.localhost`, …) with a 422. Use `.example` addresses for test accounts.
22. **The schema was reset when Alembic was introduced (2026-10-15).** If an old local DB has tables but no `alembic_version`, the backend will fail on `upgrade head` with "relation already exists". Run `bun run db:reset`.
23. **Next's `/api` rewrite can't forward request bodies over 10 MB.** It returns a 500 "socket hang up", and FastAPI never sees the request. Verified with and without `proxy.ts`, so it's the rewrite itself, not the auth proxy. Large intake uploads (120-page PDFs) must go **straight to MinIO via presigned PUT URLs**, with the API only registering the object key (§3).
24. **`JWT_SECRET` must be identical for the backend and frontend.** Both read it from the root `.env` through compose. After changing it, restart both containers (`bun run dev`). Every existing session then becomes invalid, which is expected.
25. **The refresh cookie moved from `Path=/api/auth` to `Path=/` (2026-10-15).** A browser that signed in before may still hold the old cookie until it expires. It's harmless: when both are sent, Starlette keeps the last one, which is the new one.

## 16. Open Questions

- Data model (§9) — blocked on feature decisions in CONTEXT §7.
- How new cases enter the vault beyond seed data (UI upload? "save triage as case"?).
- Chunking strategy per source type: post-mortem sections, Slack messages/threads, schema files, PDFs.
- Delta for the #1 match only, or all three (eager vs. on demand)?
- Citation model: add `evidence` / `chunk_id` to delta items and pitfall warnings? (see the pipeline reference, "Proposed contract extension")
- Auth follow-ups: rate limiting, password reset (Mailpit is ready for the emails), and whether vault `Person` records link to `users`.
