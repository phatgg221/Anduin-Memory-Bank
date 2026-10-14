/**
 * Database migrations — Alembic, run inside the backend container (files land in backend/migrations/versions/).
 *
 *   bun run db:revision "add case tables"   autogenerate a migration from the ORM models (diff vs. the DB)
 *   bun run db:revision "seed roles" --empty   blank migration to hand-write (data fixes, extensions, …)
 *   bun run db:migrate [rev]                apply migrations (default: head)
 *   bun run db:downgrade [rev]              roll back (default: one step, -1)
 *   bun run db:current                      revision the database is at
 *   bun run db:history                      all revisions, current one marked
 *   bun run db:check                        fail if the models have changes no migration covers
 *   bun run db:reset [--yes]                wipe the database and re-apply every migration (dev only)
 */
import { execIn, requireRunning } from "./docker";

const [action, ...args] = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith("--"));
const positional = args.filter((arg) => !arg.startsWith("--"));

await requireRunning("backend");
const alembic = (...alembicArgs: string[]) => execIn("backend", ["alembic", ...alembicArgs]);

switch (action) {
  case "revision": {
    const message = positional.join(" ").trim();
    if (!message) {
      console.error('usage: bun run db:revision "describe the change" [--empty]');
      process.exit(1);
    }
    const autogenerate = flags.includes("--empty") ? [] : ["--autogenerate"];
    const code = await alembic("revision", ...autogenerate, "-m", message);
    if (code === 0) {
      console.log("\nReview the new file in backend/migrations/versions/, then apply it: bun run db:migrate");
    }
    process.exit(code);
  }
  case "migrate":
    process.exit(await alembic("upgrade", positional[0] ?? "head"));
  case "downgrade":
    process.exit(await alembic("downgrade", positional[0] ?? "-1"));
  case "current":
    process.exit(await alembic("current", "--verbose"));
  case "history":
    process.exit(await alembic("history", "--indicate-current"));
  case "check":
    process.exit(await alembic("check"));
  case "reset": {
    const ok = flags.includes("--yes") || confirm("Wipe ALL data in the dev database and re-apply every migration?");
    if (!ok) {
      console.log("Aborted.");
      process.exit(1);
    }
    process.exit(await execIn("backend", ["python", "-m", "app.core.migrations", "reset"]));
  }
  default:
    console.error("usage: bun scripts/db.ts revision|migrate|downgrade|current|history|check|reset — see header");
    process.exit(1);
}
