/**
 * Start (or rebuild) the stack with hot reload and follow app logs.
 *   bun run dev               start / rebuild changed images
 *   bun run dev --refresh-db  also wipe the DB, re-apply all migrations, then seed
 * Ctrl-C stops following logs; containers keep running (`bun run stop` to stop them).
 */
import { compose, execIn, printUrls, syncEnv, waitForHealthy } from "./docker";

// Picks up variables added to .env.example since your last run (e.g. a generated JWT_SECRET).
syncEnv();

const refreshDb = process.argv.includes("--refresh-db");

// --renew-anon-volumes refreshes the container's node_modules after dependency changes.
await compose(["up", "-d", "--build", "--renew-anon-volumes"]);
await waitForHealthy(["postgres", "minio", "backend"]);

if (refreshDb) {
  console.log("Resetting database and re-applying migrations…");
  if ((await execIn("backend", ["python", "-m", "app.core.migrations", "reset"])) !== 0) process.exit(1);
  console.log("Seeding…");
  if ((await execIn("backend", ["python", "-m", "app.seed"])) !== 0) process.exit(1);
}

printUrls();
await compose(["logs", "-f", "--tail", "30", "backend", "frontend"]);
