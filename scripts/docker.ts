/**
 * Shared Docker Compose helpers, plus small subcommands:
 *   bun scripts/docker.ts stop | logs | seed | test [pytest args] | lint | reset [--yes]
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

type ComposeService = { Service: string; State: string; Health: string };

export async function run(cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    stdio: ["inherit", opts.quiet ? "ignore" : "inherit", opts.quiet ? "ignore" : "inherit"],
  });
  return proc.exited;
}

export async function compose(args: string[]): Promise<void> {
  const code = await run(["docker", "compose", ...args]);
  if (code !== 0) throw new Error(`docker compose ${args.join(" ")} exited with ${code}`);
}

/** Run a command inside a running service container. */
export async function execIn(service: string, cmd: string[]): Promise<number> {
  const tty = process.stdin.isTTY ? [] : ["-T"];
  return run(["docker", "compose", "exec", ...tty, service, ...cmd]);
}

export async function services(): Promise<ComposeService[]> {
  const out = await Bun.$`docker compose ps --all --format json`.cwd(ROOT).quiet().text();
  const trimmed = out.trim();
  if (!trimmed) return [];
  // Compose prints either a JSON array or one JSON object per line, depending on version.
  return trimmed.startsWith("[") ? JSON.parse(trimmed) : trimmed.split("\n").map((line) => JSON.parse(line));
}

export async function waitForHealthy(names: string[], timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`Waiting for ${names.join(", ")} to be healthy`);
  while (Date.now() < deadline) {
    const status = await services();
    const pending = names.filter((name) => {
      const svc = status.find((s) => s.Service === name);
      if (svc && svc.State === "exited") {
        throw new Error(`\n${name} exited. Inspect it with: docker compose logs ${name}`);
      }
      return !svc || (svc.Health ? svc.Health !== "healthy" : svc.State !== "running");
    });
    if (pending.length === 0) {
      process.stdout.write(" ✓\n");
      return;
    }
    process.stdout.write(".");
    await Bun.sleep(2_000);
  }
  throw new Error(`\nTimed out waiting for services. Inspect with: docker compose ps && docker compose logs`);
}

export async function requireRunning(service: string): Promise<void> {
  const svc = (await services()).find((s) => s.Service === service);
  if (svc?.State !== "running") {
    console.error(`The ${service} container isn't running. Start the stack first: bun run dev`);
    process.exit(1);
  }
}

export function readEnv(): Record<string, string> {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/**
 * Keep .env in step with .env.example: create it if missing, append keys added to the example since, and generate
 * a JWT_SECRET if it's empty. Never overwrites values you've set.
 */
export function syncEnv(): void {
  const examplePath = join(ROOT, ".env.example");
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    console.log("Created .env from .env.example");
  }

  const current = readEnv();
  const missing = readFileSync(examplePath, "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null && !(match[1] in current))
    .map((match) => `${match[1]}=${match[2].trim()}`);

  let text = readFileSync(envPath, "utf8");
  if (missing.length) {
    text = `${text.replace(/\n*$/, "\n")}\n# Added from .env.example\n${missing.join("\n")}\n`;
    console.log(`Added to .env: ${missing.map((line) => line.split("=")[0]).join(", ")}`);
  }
  if (!/^JWT_SECRET=\S+/m.test(text)) {
    text = text.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(32).toString("hex")}`);
    console.log("Generated a random JWT_SECRET in .env");
  }
  writeFileSync(envPath, text);
}

export function printUrls(): void {
  const env = readEnv();
  const port = (key: string, fallback: string) => env[key] || fallback;
  console.log(`
  Workbench      http://localhost:${port("FRONTEND_PORT", "3000")}/workbench
  API docs       http://localhost:${port("FRONTEND_PORT", "3000")}/api/docs
  MinIO console  http://localhost:${port("MINIO_CONSOLE_PORT", "9001")}
  Mailpit        http://localhost:${port("MAILPIT_UI_PORT", "8025")}
  pgweb          http://localhost:${port("PGWEB_PORT", "8081")}
  Postgres       localhost:${port("POSTGRES_PORT", "5433")}
`);
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "stop":
      await compose(["stop"]);
      break;
    case "logs":
      await compose(["logs", "-f", "--tail", "100", ...rest]);
      break;
    case "seed":
      await requireRunning("backend");
      process.exit(await execIn("backend", ["python", "-m", "app.seed"]));
    case "test":
      await requireRunning("backend");
      process.exit(await execIn("backend", ["pytest", ...rest]));
    case "lint": {
      await requireRunning("backend");
      const frontend = await run(["bun", "run", "lint"], { cwd: join(ROOT, "frontend") });
      const backend = await execIn("backend", ["ruff", "check", "."]);
      process.exit(frontend || backend);
    }
    case "reset": {
      const ok =
        rest.includes("--yes") ||
        confirm("This deletes all containers AND the Postgres + MinIO volumes (all local data). Continue?");
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
      await compose(["down", "--volumes", "--remove-orphans"]);
      console.log("Stack removed. Run `bun run setup` to start fresh.");
      break;
    }
    default:
      console.error("usage: bun scripts/docker.ts stop | logs | seed | test [args] | lint | reset [--yes]");
      process.exit(1);
  }
}
