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
| `pgweb` | `sosedoff/pgweb:0.17.0` | 8081 | DB browser for development |

All host ports can be changed in `.env`. Postgres defaults to host port 5433 so it doesn't clash with a native Postgres on 5432. Inside the Docker network every service uses its standard port.

## 3. Network & Trust Boundaries

- **Same-origin API.** Browser code only calls `/api/...` on the frontend's origin. That means no CORS, one place to add auth later, and a backend that never has to be public.
- **The backend's port 8000 is published for dev convenience only.** Frontend code must never point at it. Swagger is served at `/api/docs`, so it also works through the proxy.
- **Presigned links are the only direct browser → MinIO path.** They are GET-only, short-lived (≤ 10 min), and generated fresh on each click (never cached client-side beyond their TTL).
- **Signing host ≠ internal host.** The backend talks to `minio:9000` inside the Docker network, but the browser uses `localhost:9000`. SigV4 signs the Host header, so presigned URLs must come from a second MinIO client configured with the **public** endpoint (§15.1).
- **Uploads go through the backend.** Intake files go `/api/triage` → backend (validates type/size) → MinIO. Revisit with presigned PUTs only if files get large.

## 4. Repository Layout

```text
anduin-memory-bank/
├── frontend/                     Next.js 16.4 (TypeScript, App Router, React Query, Axios, Tailwind 4, shadcn/ui)
│   ├── AGENTS.md / CLAUDE.md     Next's agent rules: read node_modules/next/dist/docs before coding
│   ├── eslint.config.mjs         enforces the layering below (no-restricted-imports / fetch)
│   ├── next.config.ts            /api/:path* rewrite → BACKEND_INTERNAL_URL; standalone; Cache Components
│   ├── components.json           shadcn config (Radix base, Nova style, lucide icons)
│   ├── app/                      (app)/ signed-in routes · (auth)/ login + register · providers.tsx · globals.css
│   ├── components/               presentational only: ui/ (shadcn), brand/ (Dejavu kit), shell/ (nav, user menu), auth/, feature folders
│   ├── store/                    React Query hooks (queryKeys.ts, auth.ts, system.ts, …)
│   ├── services/                 one typed function per endpoint (authService.ts, systemService.ts, …)
│   ├── lib/                      axiosClient.ts (only HTTP client + 401→refresh interceptor), accessToken.ts, apiError.ts, utils.ts
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
│   │   │   ├── vault/            historical cases, artifacts, knowledge chunks, ingest, presigned links
│   │   │   ├── triage/           intake API, job lifecycle, worker.py, sweeper.py
│   │   │   └── intelligence/     4-step pipeline: service, retrieval, llm_client, prompts, schemas, guard
│   │   └── seed.py               private-markets scenarios → DB + MinIO
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

### 5.2 Polling

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

### 9.2 Domain tables — TBD

**Not designed yet, on purpose** — the feature set is still being concluded. The working entity names below are for conversation only: **HistoricalCase, Person** (author; `ACTIVE` / `ALUMNI`), **Artifact, KnowledgeChunk** (text + embedding), and **TriageJob**.

Whatever the schema becomes, the architecture already needs it to support:
- chunks that carry a `vector(EMBEDDING_DIM)` embedding plus a back-pointer to their case and source (for citations);
- artifacts with a stable ID belonging to exactly one case (for the guard);
- people with ACTIVE/ALUMNI status, reachable from the knowledge they authored (for badges);
- a job record that answers the questions in §6.4.

Schema changes go through Alembic migrations (§6.3a). The domain `Person` (case author, ACTIVE/ALUMNI) is a separate concept from the auth `users` table unless we decide to link them.

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
register / login ──▶ 200 AuthOut {access_token (15 min)} + Set-Cookie dejavu_refresh (7 days, httpOnly, SameSite=Strict, Path=/api/auth)
API call ──▶ Authorization: Bearer <access_token> ──▶ deps.CurrentUser (JWT verified, type=access, user active)
401 on an API call ──▶ axios interceptor ──▶ POST /api/auth/refresh (cookie) ──▶ new access token + rotated cookie ──▶ retry once
page reload ──▶ useSession() ──▶ POST /api/auth/refresh ──▶ session restored (or 401 → /login)
logout ──▶ POST /api/auth/logout ──▶ whole token family revoked, cookie cleared
```

- **Where tokens live.**
  - The access token is held in browser memory only (`lib/accessToken.ts`), never in localStorage.
  - The refresh token is an **httpOnly** cookie, so JavaScript can't read it (verified).
  - The cookie's path is `/api/auth`, so it isn't sent with ordinary API calls or page loads.
  - `SameSite=Strict` blocks cross-site use (CSRF) of `/refresh` and `/logout`.
- **Rotation + reuse detection.**
  - Every refresh issues a new refresh token and revokes the old one.
  - If an *already-revoked* token is presented after the 30 s grace window, the whole session (family) is revoked, on the assumption it was stolen.
  - Within the grace window, a replay is treated as two tabs racing: `409`, and the client retries with the newer cookie.
  - Concurrent refreshes of one token are serialised with `SELECT … FOR UPDATE`.
- **Passwords.** Argon2id (pwdlib). Hashing runs in a thread so it doesn't block the event loop. A dummy verify for unknown emails equalises response timing.
- **JWTs.** PyJWT, HS256, signed with `JWT_SECRET` (generated into `.env` by `bun run setup` / `bun run dev`). Claims: `sub`, `type`, `jti`, `iat`, `exp`. A refresh token is rejected as an access token, and vice versa.
- **Frontend gate.** The `(app)` layout restores the session and redirects to `/login` when signed out. The `(auth)` layout redirects signed-in users to `/workbench`. The UI gate is UX only: authorisation is enforced by the API.
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
| `JWT_SECRET` | backend | 64 hex chars | Generated into `.env` by `bun run setup` / `bun run dev` when empty. Min 32 chars, enforced at startup |
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
| D2 | Browser → backend only via the Next `/api` rewrite; presigned MinIO GETs are the sole exception | Accepted | Brief; same-origin, no CORS |
| D3 | FastAPI routes mounted under `/api`; the rewrite forwards the path unchanged | Proposed | One URL shape everywhere; Swagger reachable through the proxy |
| D4 | Async SQLAlchemy 2.0 + asyncpg | Proposed | Matches async FastAPI + async LLM I/O |
| D5 | Alembic migrations own the schema (config in `pyproject.toml`); the container runs `upgrade head` on start; `create_all` is never used | Accepted | Tables now exist (auth). Changes must apply to existing DBs, not just fresh ones |
| D6 | Postgres as the job queue (`SKIP LOCKED`) + in-process worker & sweeper | Proposed | No Redis/Celery; state survives restarts |
| D7 | Job states `QUEUED → PROCESSING → COMPLETED \| FAILED` | Proposed | Unifies the brief's `PENDING` vs `QUEUED` wording |
| D8 | Provider-agnostic `llm_client` (`gemini` / `openrouter` / `fake`) | Proposed | Swap models freely; deterministic tests |
| D9 | Embeddings: one model + dim for the whole corpus, cosine distance | Proposed | `vector` columns have a fixed dimension |
| D10 | The LLM never sets IDs or scores; code overwrites them after parsing | Proposed | Kills a whole class of hallucinations |
| D11 | Two MinIO clients: internal + public signer | Accepted | Required for presigned links to work from the browser |
| D12 | Polling (~2 s) rather than SSE / WebSockets | Proposed | Works through the rewrite proxy with no extra infra |
| D13 | The pipeline returns results; the triage worker persists them | Proposed | Keeps `intelligence` free of table writes (dependency direction) |
| D14 | Object storage runs `pgsty/minio` (community MinIO build), pinned by release tag | Accepted | Official `minio/minio` images are gone from Docker Hub and Quay. S3 API and SDK are unchanged |
| D15 | Keep Next's Cache Components + Partial Prefetching on; dynamic segments ship a `loading.tsx` | Accepted | create-next-app default; mandatory in the next major |
| D16 | Storage bootstrap is non-fatal at startup; the database is fatal | Accepted | A MinIO outage shouldn't hang the whole API (§15.12) |
| D17 | Bun is the package manager only; Next.js runs on Node 22 | Accepted | Cache Components requires the Node.js runtime |
| D18 | UI kit: shadcn/ui 4.x, Radix base, Nova style (Lucide + Geist); `cn` package replaces clsx + tailwind-merge | Accepted | Radix has the most mature API/docs; Nova matches our existing Geist fonts. `cn` is shadcn's own drop-in |
| D19 | Dejavu theme: Anduin palette mapped onto shadcn roles; square + flat enforced globally; light only | Accepted | DESIGN.md. Global enforcement keeps future `shadcn add` components on-brand without hand edits |
| D20 | `/` redirects to `/workbench`; job results at `/workbench/[jobId]` | Proposed | Matches DESIGN.md routes; results stay linkable |
| D21 | Auth: short-lived JWT access token (memory) + rotating, DB-backed refresh token (httpOnly cookie, path `/api/auth`) with family revocation and reuse detection | Accepted | Revocable sessions without server-side session lookups on every request; tokens unreadable by injected scripts |
| D22 | `app/core/` holds shared infrastructure (config, db, security, storage, migrations); domain modules live in `app/modules/` | Accepted | Team convention |

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

## 16. Open Questions

- Data model (§9) — blocked on feature decisions in CONTEXT §7.
- How new cases enter the vault beyond seed data (UI upload? "save triage as case"?).
- Chunking strategy per source type: post-mortem sections, Slack messages/threads, schema files, PDFs.
- Delta for the #1 match only, or all three (eager vs. on demand)?
- Citation model: add `evidence` / `chunk_id` to delta items and pitfall warnings? (see the pipeline reference, "Proposed contract extension")
- Auth follow-ups: rate limiting, password reset (Mailpit is ready for the emails), and whether vault `Person` records link to `users`.
