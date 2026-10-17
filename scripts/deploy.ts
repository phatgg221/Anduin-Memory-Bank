/**
 * Split production deploy (docs/DEPLOY.md), driven by deploy/prod.env:
 *   bun run deploy init | realtime | backend | seed | frontend
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, run } from "./docker";

const ENV_PATH = join(ROOT, "deploy", "prod.env");
const SERVICE = "dejavu-api";
const DEPLOY_ONLY = new Set(["GCP_PROJECT", "GCP_REGION", "REALTIME_HOST", "SEED_OPERATOR_EMAIL", "SEED_DEMO_PASSWORD"]);

function readProdEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) {
    console.error("deploy/prod.env is missing: run `bun run deploy init` first.");
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function requireKeys(env: Record<string, string>, keys: string[]): void {
  const missing = keys.filter((key) => !env[key] || env[key].includes("<"));
  if (missing.length) {
    console.error(`Set these in deploy/prod.env first: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function must(cmd: string[], opts: { cwd?: string } = {}): Promise<void> {
  const code = await run(cmd, opts);
  if (code !== 0) process.exit(code);
}

async function backendUrl(env: Record<string, string>): Promise<string> {
  const format = "--format=value(status.url)";
  const out = await Bun.$`gcloud run services describe ${SERVICE} --project ${env.GCP_PROJECT} --region ${env.GCP_REGION} ${format}`.text();
  return out.trim();
}

function init(): void {
  if (!existsSync(ENV_PATH)) {
    copyFileSync(join(ROOT, "deploy", "prod.env.example"), ENV_PATH);
    console.log("Created deploy/prod.env");
  }
  let text = readFileSync(ENV_PATH, "utf8");
  for (const key of ["JWT_SECRET", "REALTIME_SECRET"]) {
    if (!new RegExp(`^${key}=\\S+`, "m").test(text)) {
      text = text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${randomBytes(32).toString("hex")}`);
      console.log(`Generated ${key}`);
    }
  }
  writeFileSync(ENV_PATH, text);
  console.log("Fill in the rest of deploy/prod.env, then: bun run deploy realtime");
}

async function realtime(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["JWT_SECRET", "REALTIME_SECRET"]);
  await must(
    ["bunx", "partykit", "deploy", "--var", `JWT_SECRET=${env.JWT_SECRET}`, "--var", `REALTIME_SECRET=${env.REALTIME_SECRET}`],
    { cwd: join(ROOT, "realtime") },
  );
  console.log("\nPut the host it printed (without https://) into REALTIME_HOST in deploy/prod.env.");
}

async function backend(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["GCP_PROJECT", "GCP_REGION", "REALTIME_HOST", "DATABASE_URL", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "JWT_SECRET"]);
  const vars: Record<string, string> = { REALTIME_URL: `https://${env.REALTIME_HOST}` };
  for (const [key, value] of Object.entries(env)) {
    if (!DEPLOY_ONLY.has(key) && value) vars[key] = value;
  }
  const varsFile = join(tmpdir(), `dejavu-cloudrun-${process.pid}.yaml`);
  writeFileSync(varsFile, Object.entries(vars).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n"), { mode: 0o600 });
  try {
    await must([
      "gcloud", "run", "deploy", SERVICE,
      "--source", join(ROOT, "backend"),
      "--project", env.GCP_PROJECT,
      "--region", env.GCP_REGION,
      "--port", "8000",
      "--allow-unauthenticated",
      // The job worker and sweeper live in the API process: keep one instance with CPU always on.
      "--min-instances", "1",
      "--max-instances", "1",
      "--no-cpu-throttling",
      "--cpu", "1",
      "--memory", "1Gi",
      "--env-vars-file", varsFile,
      "--quiet",
    ]);
  } finally {
    rmSync(varsFile, { force: true });
  }
  const url = await backendUrl(env);
  console.log(`\nBackend: ${url}  →  check ${url}/api/health, then: bun run deploy seed`);
}

async function seed(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["DATABASE_URL", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "JWT_SECRET"]);
  // The local dev backend image, pointed at the production database and bucket.
  await must([
    "docker", "run", "--rm",
    "--env-file", ENV_PATH,
    "-v", `${join(ROOT, "backend")}:/app`,
    "anduin-memory-bank-backend",
    "sh", "-c", "alembic upgrade head && python -m app.seed && python -m app.reindex",
  ]);
}

async function frontend(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["GCP_PROJECT", "GCP_REGION", "REALTIME_HOST", "JWT_SECRET"]);
  const cwd = join(ROOT, "frontend");
  if (!existsSync(join(cwd, ".vercel", "project.json"))) await must(["vercel", "link"], { cwd });
  const vars = { BACKEND_INTERNAL_URL: await backendUrl(env), NEXT_PUBLIC_REALTIME_HOST: env.REALTIME_HOST, JWT_SECRET: env.JWT_SECRET };
  for (const [key, value] of Object.entries(vars)) {
    await Bun.$`vercel env rm ${key} production --yes`.cwd(cwd).quiet().nothrow();
    await Bun.$`vercel env add ${key} production < ${new Response(value)}`.cwd(cwd).quiet();
    console.log(`Set ${key} on Vercel (production)`);
  }
  await must(["vercel", "deploy", "--prod"], { cwd });
}

const [command] = process.argv.slice(2);
switch (command) {
  case "init":
    init();
    break;
  case "realtime":
    await realtime(readProdEnv());
    break;
  case "backend":
    await backend(readProdEnv());
    break;
  case "seed":
    await seed(readProdEnv());
    break;
  case "frontend":
    await frontend(readProdEnv());
    break;
  default:
    console.error("usage: bun run deploy init | realtime | backend | seed | frontend");
    process.exit(1);
}
