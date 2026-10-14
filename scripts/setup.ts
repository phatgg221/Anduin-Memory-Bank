/**
 * One-time (and re-runnable) setup:
 *   prerequisites → .env → host deps for editor support → build images → start stack → wait for health.
 */
import { join } from "node:path";
import { ROOT, compose, printUrls, run, syncEnv, waitForHealthy } from "./docker";

async function has(cmd: string[]): Promise<boolean> {
  try {
    return (await run(cmd, { quiet: true })) === 0;
  } catch {
    return false;
  }
}

if (!(await has(["docker", "info"]))) {
  console.error("Docker isn't running (or isn't installed). Start Docker Desktop and re-run `bun run setup`.");
  process.exit(1);
}
if (!(await has(["docker", "compose", "version"]))) {
  console.error("Docker Compose v2 is required (`docker compose`).");
  process.exit(1);
}

syncEnv();

// Host-side installs only power editor IntelliSense; the containers have their own dependencies.
console.log("Installing host dependencies for editor support…");
await run(["bun", "install"], { cwd: ROOT });
await run(["bun", "install"], { cwd: join(ROOT, "frontend") });
if (await has(["uv", "--version"])) {
  await run(["uv", "sync"], { cwd: join(ROOT, "backend") });
} else {
  console.warn("uv not found: skipping the host backend venv (containers are unaffected).");
}

await compose(["build"]);
await compose(["up", "-d"]);
await waitForHealthy(["postgres", "minio", "backend", "frontend"]);

console.log("\nSetup complete. Stack is running:");
printUrls();
console.log("Next: `bun run dev` to follow logs with hot reload, `bun run test` to run the backend tests.");
