/**
 * Split production deploy (docs/DEPLOY.md), driven by deploy/prod.env:
 *   bun run deploy init | realtime | backend | seed | frontend | ci-setup
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, run } from "./docker";

const ENV_PATH = join(ROOT, "deploy", "prod.env");
const API = "dejavu-api";
const DEPLOY_ONLY = new Set([
  "GCP_PROJECT", "GCP_REGION", "CLOUDFLARE_ACCOUNT_ID", "REALTIME_HOST", "SEED_OPERATOR_EMAIL", "SEED_DEMO_PASSWORD",
]);

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
  if (code !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} exited with ${code}`);
}

async function serviceUrl(env: Record<string, string>, service: string): Promise<string> {
  const format = "--format=value(status.url)";
  const out = await Bun.$`gcloud run services describe ${service} --project ${env.GCP_PROJECT} --region ${env.GCP_REGION} ${format}`
    .quiet()
    .nothrow();
  const url = out.text().trim();
  if (out.exitCode !== 0 || !url) throw new Error(`Cloud Run service ${service} not found: run \`bun run deploy backend\` first.`);
  return url;
}

async function deployService(
  env: Record<string, string>,
  service: string,
  source: string,
  vars: Record<string, string>,
  flags: string[],
): Promise<string> {
  const varsFile = join(tmpdir(), `dejavu-${service}-${process.pid}.yaml`);
  writeFileSync(varsFile, Object.entries(vars).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n"), { mode: 0o600 });
  try {
    await must([
      "gcloud", "run", "deploy", service,
      "--source", join(ROOT, source),
      "--project", env.GCP_PROJECT,
      "--region", env.GCP_REGION,
      "--allow-unauthenticated",
      "--env-vars-file", varsFile,
      "--quiet",
      ...flags,
    ]);
  } finally {
    rmSync(varsFile, { force: true });
  }
  return serviceUrl(env, service);
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

function setProdEnv(key: string, value: string): void {
  const text = readFileSync(ENV_PATH, "utf8");
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(ENV_PATH, pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n*$/, "\n")}${line}\n`);
}

async function realtime(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["CLOUDFLARE_ACCOUNT_ID", "JWT_SECRET", "REALTIME_SECRET"]);
  const secretsFile = join(tmpdir(), `dejavu-realtime-${process.pid}.json`);
  writeFileSync(secretsFile, JSON.stringify({ JWT_SECRET: env.JWT_SECRET, REALTIME_SECRET: env.REALTIME_SECRET }), { mode: 0o600 });
  let output = "";
  try {
    const proc = Bun.spawn(["bunx", "wrangler", "deploy", "--secrets-file", secretsFile], {
      cwd: join(ROOT, "realtime"),
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID },
      stdio: ["inherit", "pipe", "inherit"],
    });
    for await (const chunk of proc.stdout) {
      const text = new TextDecoder().decode(chunk);
      output += text;
      process.stdout.write(text);
    }
    if ((await proc.exited) !== 0) throw new Error("wrangler deploy failed");
  } finally {
    rmSync(secretsFile, { force: true });
  }
  const host = output.match(/https:\/\/([\w.-]+\.workers\.dev)/)?.[1];
  if (!host) throw new Error("Couldn't find the workers.dev URL in wrangler's output: set REALTIME_HOST in deploy/prod.env by hand.");
  setProdEnv("REALTIME_HOST", host);
  console.log(`\nRealtime: wss://${host}  (saved as REALTIME_HOST)  →  next: bun run deploy backend`);
}

async function backend(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["GCP_PROJECT", "GCP_REGION", "REALTIME_HOST", "DATABASE_URL", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "JWT_SECRET"]);
  const vars: Record<string, string> = { REALTIME_URL: `https://${env.REALTIME_HOST}` };
  for (const [key, value] of Object.entries(env)) {
    if (!DEPLOY_ONLY.has(key) && value) vars[key] = value;
  }
  // The job worker and sweeper live in the API process: keep one instance with CPU always on.
  const url = await deployService(env, API, "backend", vars, [
    "--port", "8000", "--min-instances", "1", "--max-instances", "1", "--no-cpu-throttling", "--cpu", "1", "--memory", "1Gi",
  ]);
  console.log(`\nBackend: ${url}  →  check ${url}/api/health, then: bun run deploy seed`);
}

async function seed(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["DATABASE_URL", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "JWT_SECRET"]);
  // The local dev backend image, pointed at the production database and bucket. Cloud Run's worker embeds the cases.
  await must([
    "docker", "run", "--rm",
    "--env-file", ENV_PATH,
    "-v", `${join(ROOT, "backend")}:/app`,
    "anduin-memory-bank-backend",
    "sh", "-c", "alembic upgrade head && python -m app.seed",
  ]);
}

async function frontend(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["GCP_PROJECT", "GCP_REGION", "REALTIME_HOST", "JWT_SECRET"]);
  const cwd = join(ROOT, "frontend");
  if (!existsSync(join(cwd, ".vercel", "project.json"))) await must(["vercel", "link"], { cwd });
  const vars = {
    BACKEND_INTERNAL_URL: await serviceUrl(env, API),
    NEXT_PUBLIC_REALTIME_HOST: env.REALTIME_HOST,
    JWT_SECRET: env.JWT_SECRET,
  };
  for (const [key, value] of Object.entries(vars)) {
    await Bun.$`vercel env rm ${key} production --yes`.cwd(cwd).quiet().nothrow();
    await Bun.$`vercel env add ${key} production < ${new Response(value)}`.cwd(cwd).quiet();
    console.log(`Set ${key} on Vercel (production)`);
  }
  await must(["vercel", "deploy", "--prod"], { cwd });
}

async function quietly(cmd: string[]): Promise<boolean> {
  return (await run(cmd, { quiet: true })) === 0;
}

async function ciSetup(env: Record<string, string>): Promise<void> {
  requireKeys(env, ["GCP_PROJECT", "GCP_REGION", "CLOUDFLARE_ACCOUNT_ID"]);
  const vercelLink = join(ROOT, "frontend", ".vercel", "project.json");
  if (!existsSync(vercelLink)) throw new Error("Run `bun run deploy frontend` once first, so the Vercel project is linked.");
  const { orgId, projectId } = JSON.parse(readFileSync(vercelLink, "utf8"));
  const repo = (await Bun.$`gh repo view --json nameWithOwner -q .nameWithOwner`.cwd(ROOT).text()).trim();
  const project = env.GCP_PROJECT;
  const number = (await Bun.$`gcloud projects describe ${project} --format=${"value(projectNumber)"}`.text()).trim();
  const account = `github-deployer@${project}.iam.gserviceaccount.com`;
  const p = ["--project", project, "--quiet"];

  console.log(`Keyless GitHub → Google Cloud auth for ${repo} in ${project}…`);
  await must(["gcloud", "services", "enable", "iamcredentials.googleapis.com", "sts.googleapis.com", ...p]);
  if (!(await quietly(["gcloud", "iam", "service-accounts", "describe", account, ...p]))) {
    await must(["gcloud", "iam", "service-accounts", "create", "github-deployer", "--display-name", "GitHub Actions deploy", ...p]);
  }
  for (const role of [
    "roles/run.admin",
    "roles/cloudbuild.builds.editor",
    "roles/artifactregistry.writer",
    "roles/storage.admin",
    "roles/iam.serviceAccountUser",
    "roles/logging.viewer",
    "roles/serviceusage.serviceUsageConsumer",
  ]) {
    await must(["gcloud", "projects", "add-iam-policy-binding", project, "--member", `serviceAccount:${account}`, "--role", role, "--condition", "None", "--quiet"]);
  }
  const pool = ["--workload-identity-pool", "github", "--location", "global"];
  if (!(await quietly(["gcloud", "iam", "workload-identity-pools", "describe", "github", "--location", "global", ...p]))) {
    await must(["gcloud", "iam", "workload-identity-pools", "create", "github", "--location", "global", "--display-name", "GitHub Actions", ...p]);
  }
  if (!(await quietly(["gcloud", "iam", "workload-identity-pools", "providers", "describe", "github-oidc", ...pool, ...p]))) {
    await must([
      "gcloud", "iam", "workload-identity-pools", "providers", "create-oidc", "github-oidc", ...pool,
      "--issuer-uri", "https://token.actions.githubusercontent.com",
      "--attribute-mapping", "google.subject=assertion.sub,attribute.repository=assertion.repository",
      "--attribute-condition", `assertion.repository=='${repo}'`,
      ...p,
    ]);
  }
  await must([
    "gcloud", "iam", "service-accounts", "add-iam-policy-binding", account,
    "--role", "roles/iam.workloadIdentityUser",
    "--member", `principalSet://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/github/attribute.repository/${repo}`,
    ...p,
  ]);

  const variables = {
    GCP_PROJECT: project,
    GCP_REGION: env.GCP_REGION,
    GCP_SERVICE_ACCOUNT: account,
    GCP_WORKLOAD_IDENTITY_PROVIDER: `projects/${number}/locations/global/workloadIdentityPools/github/providers/github-oidc`,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    VERCEL_ORG_ID: orgId,
    VERCEL_PROJECT_ID: projectId,
  };
  for (const [key, value] of Object.entries(variables)) {
    await must(["gh", "variable", "set", key, "--repo", repo, "--body", value]);
  }
  console.log(`\nSet ${Object.keys(variables).length} GitHub variables on ${repo}.`);
  console.log("\nNow two secrets, pasted when gh asks (input is hidden):");
  console.log("  CLOUDFLARE_API_TOKEN  dash.cloudflare.com/profile/api-tokens → Create Token → \"Edit Cloudflare Workers\" template");
  console.log("  VERCEL_TOKEN          vercel.com/account/settings/tokens → Create, scoped to your team\n");
  for (const name of ["CLOUDFLARE_API_TOKEN", "VERCEL_TOKEN"]) {
    await must(["gh", "secret", "set", name, "--repo", repo]);
  }
  console.log("\nDone. Push to main (or run the Deploy workflow by hand) to deploy through GitHub Actions.");
}

const [command] = process.argv.slice(2);
process.on("unhandledRejection", (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
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
  case "ci-setup":
    await ciSetup(readProdEnv());
    break;
  default:
    console.error("usage: bun run deploy init | realtime | backend | seed | frontend | ci-setup");
    process.exit(1);
}
