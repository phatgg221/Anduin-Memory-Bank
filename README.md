# Dejavu — Institutional Memory Engine

*Stop solving the same problem twice. Every past project, instantly recalled.*

Dejavu (repo: Anduin Memory Bank) is a trigger-first case triage workbench for private-markets onboarding. Drop in a new fund-onboarding request and see:
- the most similar past cases;
- how those cases went, including knowledge from people who have since left;
- what's different this time.

Built for the Anduin "Agent in the Shell" challenge (KNOWLEDGE — The Memory Bank).

- Product & domain: [CONTEXT.md](CONTEXT.md)
- System design: [ARCHITECTURE.md](ARCHITECTURE.md)
- Brand & UI: [DESIGN.md](DESIGN.md)

## Prerequisites

- Docker Desktop (Compose v2)
- [Bun](https://bun.sh) ≥ 1.3
- [uv](https://docs.astral.sh/uv/) (optional, for editor support for the backend)

## Quick start

```bash
bun run setup
```

This creates `.env` from `.env.example`, builds the images, starts the stack, and waits until everything is healthy. Then open:

| | URL |
|---|---|
| Workbench | http://localhost:3000/workbench |
| API docs (Swagger) | http://localhost:3000/api/docs |
| MinIO console | http://localhost:9001 |
| Mailpit | http://localhost:8025 |
| pgweb | http://localhost:8081 |
| Postgres | `localhost:5433` |

Ports clash with something already running? Change them in `.env`.

## Day to day

| Command | Does |
|---|---|
| `bun run dev` | Start / rebuild the stack with hot reload and follow logs (Ctrl-C detaches; containers keep running) |
| `bun run dev --refresh-db` | Same, plus drop + recreate tables and re-seed |
| `bun run stop` | Stop containers |
| `bun run logs [service]` | Follow logs |
| `bun run seed` | Seed the vault |
| `bun run test [pytest args]` | Backend tests inside the container (`bun run test`, not `bun test`) |
| `bun run lint` | ESLint (frontend) + ruff (backend) |
| `bun run reset` | Delete containers **and all local data** (asks first) |

## Layout

```text
frontend/   Next.js 16.4 · React Query · Axios · Tailwind 4 · shadcn/ui (Dejavu theme)
backend/    FastAPI · SQLAlchemy 2 (async) · pgvector · MinIO SDK · uv
docker/     Postgres init SQL
scripts/    Bun scripts behind the commands above
```
