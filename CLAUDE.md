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
- **The table schema is intentionally undecided** because functionality is still being concluded.
  - Do not invent tables or columns, or write migrations, without asking. Entity names in the docs (HistoricalCase, Person, Artifact, KnowledgeChunk, TriageJob) are working names only.
  - As a result, `vault`/`triage` routers are empty, the job worker and sweeper aren't wired, `seed.py` is a stub, and the workbench panes are empty.
- `PLAN.md` is still to be written.
- If a task needs a product decision (CONTEXT.md §7, DESIGN.md §8), ask instead of guessing.

## Non-negotiables

- The browser reaches the backend only via the Next `/api/*` rewrite. The sole exception is presigned MinIO GETs for raw files.
- Frontend: `page → store hook (React Query) → service → lib/axiosClient → /api`. Components are presentational. ESLint enforces this.
- UI: Dejavu tokens only (no raw hex). Square corners, 1px hairlines, no shadows, light theme. Use the `components/brand/` kit before composing raw classes.
- Backend: `router → service → SQLAlchemy`, one folder per domain in `backend/app/modules/`. Dependency direction: `triage → intelligence → vault → core/db`.
- LLM work runs only as a persisted job (`QUEUED → PROCESSING → COMPLETED | FAILED`) with UI polling, never inside a request.
- Every LLM output is Pydantic-validated and guarded. The LLM never sets IDs or similarity scores.
- Seed data uses realistic private-markets scenarios, never lorem ipsum.

## Commands

`bun run setup` · `bun run dev` · `bun run dev --refresh-db` · `bun run stop` · `bun run logs` · `bun run seed` · `bun run test` · `bun run lint` · `bun run reset` (destroys volumes — confirm with the user first)

- Before calling a frontend route done, run `bun run build` in `frontend/`. Cache Components errors only show up at build time.
- After adding frontend dependencies (`bun add`, `shadcn add`), run `bun run dev` so the container picks them up.
- Postgres is published on host port 5433.
