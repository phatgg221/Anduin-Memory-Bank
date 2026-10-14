/**
 * Start (or rebuild) the stack with hot reload and follow app logs.
 *   bun run dev               start / rebuild changed images
 *   bun run dev --refresh-db  also drop + recreate tables, then seed
 * Ctrl-C stops following logs; containers keep running (`bun run stop` to stop them).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, compose, execIn, printUrls, waitForHealthy } from "./docker";

if (!existsSync(join(ROOT, ".env"))) {
  console.error("No .env found. Run `bun run setup` first.");
  process.exit(1);
}

const refreshDb = process.argv.includes("--refresh-db");

// --renew-anon-volumes refreshes the container's node_modules after dependency changes.
await compose(["up", "-d", "--build", "--renew-anon-volumes"]);
await waitForHealthy(["postgres", "minio", "backend"]);

if (refreshDb) {
  console.log("Refreshing database schema…");
  if ((await execIn("backend", ["python", "-m", "app.db.schema", "refresh"])) !== 0) process.exit(1);
  console.log("Seeding…");
  if ((await execIn("backend", ["python", "-m", "app.seed"])) !== 0) process.exit(1);
}

printUrls();
await compose(["logs", "-f", "--tail", "30", "backend", "frontend"]);
