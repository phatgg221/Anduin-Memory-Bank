# Dejavu (repo: Anduin Memory Bank)

Hackathon project for Anduin's "Agent in the Shell" challenge (track: KNOWLEDGE — The Memory Bank, Oct 9–22 2026). The product is branded **Dejavu** — *"Stop solving the same problem twice."* It is a **trigger-first case triage workbench**, not a chatbot. A new fund-onboarding request comes in, and the workbench shows:
- the Top 3 similar past cases;
- how those cases went (including `ALUMNI` knowledge);
- a Delta Matrix of what is REUSABLE / MODIFIED / NET_NEW;
- 1-click reuse of past artifacts.

## Read first

- [CONTEXT.md](CONTEXT.md) — domain, problem, product thesis, persona, glossary, open product questions.
- [ARCHITECTURE.md](ARCHITECTURE.md) — services, network rules, module layout, job lifecycle, pipeline, decisions, gotchas.
- [DESIGN.md](DESIGN.md) — Dejavu brand, Anduin tokens, signature components, view sketches, implied capabilities.
- Skill **`anduin-memory-bank`** (`.claude/skills/anduin-memory-bank/`) — coding rules, design system, code templates, LLM contracts, seed data. Load it before writing any frontend/backend code, UI, prompts, or seed data.
- `frontend/AGENTS.md` — Next.js 16.4 is newer than your training data; read `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs.

## Current status (2026-10-15)

- **Scaffolded and running end to end:**
  - Next.js 16.4 frontend, FastAPI backend, Postgres + pgvector, MinIO, Mailpit, and pgweb in Docker Compose, managed by bun scripts.
  - `/api/health` flows browser → Next `/api` rewrite → FastAPI → Postgres/MinIO.
- **UI system in place:**
  - shadcn/ui (Radix, Nova) themed with the Dejavu tokens, plus the brand kit (`components/brand/`) and the persistent top nav.
  - `/workbench` shows the empty 3-pane frame with a system status bar.
- **Auth built:** `/register` (email, name, password, confirm) and `/login`.
  - A JWT access token (in memory) plus a rotating, revocable refresh token (httpOnly cookie). Tables: `users`, `refresh_tokens`. See ARCHITECTURE §10a.
  - `frontend/proxy.ts` (Next 16 Proxy) gates every page server-side, default-deny, by verifying the refresh cookie. New API routes take `user: CurrentUser`, which is the real enforcement.
  - `JWT_SECRET` must be the same for backend and frontend; compose passes it to both.
- **Alembic owns the schema** (`backend/migrations/`). Every model change ships with a migration from `bun run db:revision`; `create_all` is never used.
- **Domain schema built** (ARCHITECTURE §9.2): `departments` (module `org`), extended `users` (department, role, ALUMNI via `is_active`/`departed_at`), and in module `cases`: `case_records` (OPEN channel → RESOLVED memory), `case_artifacts`, `channel_messages`, `copilot_messages`, `knowledge_chunks` (pgvector, HNSW).
  - Every user sees every department (no RBAC walls in the MVP); the department switcher only filters.
  - Still undecided: the job table for ANALYZE/SUMMARIZE runs. Don't invent it without asking.
- **Seed pack loaded by `bun run seed`:** 5 departments, 7 colleagues (2 ALUMNI) plus your account via `SEED_OPERATOR_EMAIL`, 8 resolved cases, 3 open demo channels with pre-computed `comparison_results`, 26 artifacts in MinIO. Knowledge chunks aren't embedded yet.
- Not built yet: domain API routes, the job worker/sweeper, the intelligence pipeline, and the workbench panes.
- `PLAN.md` is still to be written.
- If a task needs a product decision (CONTEXT.md §7, DESIGN.md §8), ask instead of guessing.

## Non-negotiables

- The browser reaches the backend only via the Next `/api/*` rewrite. The sole exception is presigned MinIO GETs for raw files.
- Frontend: `page → store hook (React Query) → service → lib/axiosClient → /api`. Components are presentational. ESLint enforces this.
- **No N+1 fetching from the UI:** a fixed number of requests per screen, never one per row. The backend serves view-shaped endpoints with a fixed number of SQL queries.
- **UI first:** mutations are optimistic. Update the cache, send the request, roll back and notify on error (after retrying transient failures), then re-sync. Writes are idempotent. Exceptions: auth, server-computed results, irreversible actions.
- UI: Dejavu tokens only (no raw hex). Square corners, 1px hairlines, no shadows, light theme. Use the `components/brand/` kit before composing raw classes.
- Backend: `router → service → SQLAlchemy`, one folder per domain in `backend/app/modules/`, shared infrastructure in `backend/app/core/`. Dependency direction: `triage → intelligence → vault → core`; any module may use `auth.deps.CurrentUser`.
- Schema changes = an Alembic migration (`bun run db:revision "msg"` → review → `bun run db:migrate`). Tokens never go in URLs, logs, or localStorage.
- LLM work runs only as a persisted job (`QUEUED → PROCESSING → COMPLETED | FAILED`) with UI polling, never inside a request.
- Every LLM output is Pydantic-validated and guarded. The LLM never sets IDs or similarity scores.
- Seed data uses realistic private-markets scenarios, never lorem ipsum.

## Commands

`bun run setup` · `bun run dev` · `bun run dev --refresh-db` · `bun run stop` · `bun run logs` · `bun run seed` · `bun run test` · `bun run lint` · `bun run reset` (destroys volumes — confirm with the user first)

Migrations: `bun run db:revision "msg" [--empty]` · `db:migrate` · `db:downgrade` · `db:current` · `db:history` · `db:check` · `db:reset` (wipes dev data — confirm first)

- Before calling a frontend route done, run `bun run build` in `frontend/`. Cache Components errors only show up at build time.
- After adding frontend dependencies (`bun add`, `shadcn add`), run `bun run dev` so the container picks them up.
- Postgres is published on host port 5433.
