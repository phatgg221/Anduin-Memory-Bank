# Anduin Memory Bank

Hackathon project for Anduin's "Agent in the Shell" challenge (track: KNOWLEDGE — The Memory Bank, Oct 9–22 2026). It is a **trigger-first case triage workbench**, not a chatbot. A new fund-onboarding request comes in, and the workbench shows:
- the Top 3 similar past cases;
- how those cases went (including `ALUMNI` knowledge);
- a Delta Matrix of what is REUSABLE / MODIFIED / NET_NEW;
- 1-click reuse of past artifacts.

## Read first

- [CONTEXT.md](CONTEXT.md) — domain, problem, product thesis, persona, glossary, open product questions.
- [ARCHITECTURE.md](ARCHITECTURE.md) — services, network rules, module layout, job lifecycle, pipeline, decisions, gotchas.
- Skill **`anduin-memory-bank`** (`.claude/skills/anduin-memory-bank/`) — coding rules, code templates, LLM contracts, seed data. Load it before writing any frontend/backend code, prompts, or seed data.
- `frontend/AGENTS.md` — Next.js 16.4 is newer than your training data; read `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs.

## Current status (2026-10-14)

- **Scaffolded and running end to end:**
  - Next.js 16.4 frontend, FastAPI backend, Postgres + pgvector, MinIO, Mailpit, and pgweb in Docker Compose, managed by bun scripts.
  - `/api/health` flows browser → Next `/api` rewrite → FastAPI → Postgres/MinIO, and the workbench home page shows it in a status panel.
- **The table schema is intentionally undecided** because functionality is still being concluded.
  - Do not invent tables or columns, or write migrations, without asking. Entity names in the docs (HistoricalCase, Person, Artifact, KnowledgeChunk, TriageJob) are working names only.
  - As a result, `vault`/`triage` routers are empty, the job worker and sweeper aren't wired, and `seed.py` is a stub.
- `DESIGN.md` and `PLAN.md` are still to be written.
- If a task needs a product decision listed in CONTEXT.md §7, ask instead of guessing.

## Non-negotiables

- The browser reaches the backend only via the Next `/api/*` rewrite. The sole exception is presigned MinIO GETs for raw files.
- Frontend: `page → store hook (React Query) → service → lib/axiosClient → /api`. Components are presentational. ESLint enforces this.
- Backend: `router → service → SQLAlchemy`, one folder per domain in `backend/app/modules/`. Dependency direction: `triage → intelligence → vault → core/db`.
- LLM work runs only as a persisted job (`QUEUED → PROCESSING → COMPLETED | FAILED`) with UI polling, never inside a request.
- Every LLM output is Pydantic-validated and guarded. The LLM never sets IDs or similarity scores.
- Seed data uses realistic private-markets scenarios, never lorem ipsum.

## Commands

`bun run setup` · `bun run dev` · `bun run dev --refresh-db` · `bun run stop` · `bun run logs` · `bun run seed` · `bun run test` · `bun run lint` · `bun run reset` (destroys volumes — confirm with the user first)

- Before calling a frontend route done, run `bun run build` in `frontend/`. Cache Components errors only show up at build time.
- Postgres is published on host port 5433.
