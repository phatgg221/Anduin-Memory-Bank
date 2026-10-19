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
- [docs/RAG.md](docs/RAG.md) — how memory works: chunking, embeddings, retrieval and ranking, grounding and guards. [docs/DEPLOY.md](docs/DEPLOY.md) — production deploy and CI/CD. [docs/SAMPLE_CASES.md](docs/SAMPLE_CASES.md) — ready-to-paste demo requests per department.
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
- **Domain schema built** (ARCHITECTURE §9.2): `departments` (module `org`), extended `users` (department, role, ALUMNI via `is_active`/`departed_at`), and in module `cases`: `case_records` (OPEN channel → RESOLVED memory), `case_artifacts`, `channel_messages`, `case_members`, `copilot_messages`, `knowledge_chunks` (pgvector, HNSW).
  - Every user sees every case, its precedents, delta and kit, but **chats are members-only**: case channels (`case_members`) and department channels (`room_members`; the lead and the department's own people always belong). Non-members get a locked panel with "Ask to join"; any member approves. The copilot and memory drafts read the chat, so they're members-only too. The department switcher only filters.
  - `case_jobs` (module `triage`) runs SUMMARIZE and INDEX jobs with a worker + sweeper in the API process (ARCHITECTURE §9.2). An ANALYZE job (live precedent matching) isn't built yet.
- **Seed pack loaded by `bun run seed`:** 5 departments, 7 colleagues (2 ALUMNI) plus your account via `SEED_OPERATOR_EMAIL`, 8 resolved cases, 3 open demo channels with pre-computed `comparison_results`, 26 artifacts in MinIO. Knowledge chunks aren't embedded yet.
- **Built UI:** the **Workbench** is the landing hub (new-case intake, department channels, active case rooms) with child pages `/workbench/cases/[caseId]` (details left · channel / precedent & delta / memory copilot / people tabs · reusable kit right → complete & save to memory) and `/workbench/rooms/[departmentId]`; resizable panes on wide screens; the old War Room tab merged into it (department rooms live on as each department's general room). Before the merge it was the War Room ( one chat per department, lead + department members by default, pinned case with its precedents, PartyServer websockets for live messages/presence/typing with polling as fallback, optimistic send; each open case is a sub-chat thread under every department it involves; "+ New case thread" is a full intake (customer, problem & context, severity, deadline, owner, context tags) and each thread has an editable Case details tab), Workbench (empty 3-pane frame), Knowledge Vault (resolved cases + files by department). The header department switcher is saved per user (`users.active_department_id`).
- **Resolve & Commit to the Knowledge Base** is built: Dejavu asks for the outcome + final output + deliverables → memory curator job (summarizer from the case chat, reusable-file suggestions, contradiction check vs older cases) → human review → commit (case RESOLVED, outcome stored, chosen files reusable) → index into pgvector. LLM via `llm_client` (`fake` by default; OpenRouter when `LLM_PROVIDER=openrouter`, `LLM_MODEL`, `OPENROUTER_API_KEY` are set).
- **RAG:** every resolved case is chunked and embedded into `knowledge_chunks`; `GET /api/memory/search?q=` does semantic retrieval. `bun run reindex` re-embeds everything after an embedding-model change.
- **ANALYZE is the triage agent** (Gemini 2.5 Flash tool calling via OpenRouter, `AGENT_MODEL`): indexes the intake into pgvector, investigates with tools (vault search, duplicates, past cases, people, effort) shown live, then a guarded triage report (summary, risk & effort, missing info, team, duplicates) + the delta matrix. **COPILOT** (grounded Q&A, also `@Dejavu` in the channel). **Solution review**: pick any channel messages → Dejavu checks the proposed solution against memory and this case's files, posting verdicts with case / file / page citations (ARCHITECTURE §9.2). **Reuse brief**: "Use in case" makes Dejavu post what the file is, why it fits this case, what to change and what to watch, with page citations. Intake files go through MarkItDown.
- Not built yet: a persona switcher (sign in as another colleague in one browser), bulk legacy import on Ingest Archive, and attaching new files from the chat composer.
- `PLAN.md` is still to be written.
- If a task needs a product decision (CONTEXT.md §7, DESIGN.md §8), ask instead of guessing.

## Non-negotiables

- The browser reaches the backend only via the Next `/api/*` rewrite. Exceptions: presigned MinIO GETs for raw files, and the PartyServer war-room websocket (`realtime/`, port 1999), which authenticates with the access token as its first message, never in the URL.
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

`bun run setup` · `bun run dev` · `bun run dev --refresh-db` · `bun run stop` · `bun run logs` · `bun run seed` · `bun run reindex [--missing]` · `bun run test` · `bun run lint` · `bun run format` · `bun run reset` (destroys volumes — confirm with the user first)

Migrations: `bun run db:revision "msg" [--empty]` · `db:migrate` · `db:downgrade` · `db:current` · `db:history` · `db:check` · `db:reset` (wipes dev data — confirm first)

- Before calling a frontend route done, run `bun run build` in `frontend/`. Cache Components errors only show up at build time.
- After adding frontend dependencies (`bun add`, `shadcn add`), run `bun run dev` so the container picks them up.
- Postgres is published on host port 5433. PartyServer (`realtime` service) on 1999; `bun run dev` generates `REALTIME_SECRET` like `JWT_SECRET`.
