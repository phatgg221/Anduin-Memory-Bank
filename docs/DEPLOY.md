# Deploying Dejavu

| Piece | Runs on | Notes |
|---|---|---|
| Frontend (Next.js) | **Vercel** | `/api/*` is rewritten to the Cloud Run URL, so the browser stays same-origin and the refresh cookie works |
| Backend (FastAPI + job worker) | **Google Cloud Run** | 1 instance, CPU always on: the job worker and sweeper run inside the API process |
| Postgres + pgvector | **Neon** | Migrations run on every backend start |
| File storage | **Cloudflare R2** | S3 API; presigned links are https |
| Realtime (PartyServer) | **Cloudflare Workers** + Durable Objects | One Durable Object per chat room on `dejavu-realtime.<subdomain>.workers.dev`; no domain needed. Browsers connect over wss, the API publishes over https |

Everything reads one file, `deploy/prod.env` (gitignored), through `bun run deploy <step>`.
Pick the same region everywhere (default: US East — Cloud Run `us-east1`, Neon `aws-us-east-1`, Vercel `iad1`).

Cost: Vercel Hobby, Neon, R2 and Workers (free plan, SQLite-backed Durable Objects) are free at this scale. Cloud Run
with an always-on 1 vCPU / 1 GiB instance is about $45–55/month; a new GCP account's $300 credit covers it.
(PartyKit's hosted platform stopped accepting deploys on 16 Oct 2026; the server now uses PartyServer, its successor.)

## 0. Accounts and CLIs (once)

- **Google Cloud**: a project with billing on. Install the CLI (`brew install --cask google-cloud-sdk`), then
  `gcloud auth login` and
  `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project <id>`.
- **Neon**: a project in the same region (AWS US East 1). Copy the **direct** connection string (not the `-pooler` host).
- **Cloudflare R2**: a bucket (e.g. `dejavu`) and an R2 API token with Object Read & Write on it. Note the
  account id, access key id and secret.
- **Cloudflare Workers** (any account you can deploy to; its id goes in `CLOUDFLARE_ACCOUNT_ID`): `cd realtime && bunx wrangler login`. The first deploy asks you to pick a
  free `workers.dev` subdomain if the account has none yet.
- **Vercel**: `vercel login`.
- **OpenRouter**: set a monthly spending limit on the key you'll use.

## 1. Configure

```bash
bun run deploy init
```

This creates `deploy/prod.env` with fresh `JWT_SECRET` / `REALTIME_SECRET`. Fill in `GCP_PROJECT`, `CLOUDFLARE_ACCOUNT_ID`,
`DATABASE_URL`, the R2 values (`MINIO_*`) and the LLM keys. Neon's `postgresql://…?sslmode=require` URL works as is.

## 2. Deploy, in this order

```bash
bun run deploy realtime   # wrangler deploy with the two secrets; saves the workers.dev host as REALTIME_HOST
bun run deploy backend    # builds backend/Dockerfile on Cloud Build, deploys dejavu-api, prints its URL
bun run deploy seed       # demo data + files into Neon and R2; Cloud Run's worker then embeds the cases
bun run deploy frontend   # links the Vercel project (first run), sets its env vars, deploys to production
```

`deploy frontend` sets three Vercel env vars: `BACKEND_INTERNAL_URL` (the Cloud Run URL), `NEXT_PUBLIC_REALTIME_HOST`
and `JWT_SECRET` (must match the backend's and the Worker's). The first two are baked in at build time, so a change needs a redeploy.

Then register on the live site, put your email in `SEED_OPERATOR_EMAIL`, and run `bun run deploy seed` again
(it's idempotent).

## 3. Check

- `https://<vercel-domain>/api/health` → database and storage `true`.
- Sign in, reload: still signed in (secure refresh cookie).
- Open a kit file: the link is `https://<account-id>.r2.cloudflarestorage.com/…`.
- Two browsers: a message appears live in the other (wss to `dejavu-realtime.<subdomain>.workers.dev`).
- Upload an intake PDF of a few MB: Vercel's proxy has request-size limits, so test the largest file you'll demo.

## Updating

Re-run the step for what changed: `bun run deploy realtime`, `backend` or `frontend` (or connect the GitHub repo
to the Vercel project with root directory `frontend/` for deploys on push).

## Alternative: one VM

`docker-compose.prod.yml` + `Caddyfile` run the whole stack on a single Linux VM behind Caddy (HTTPS on
`dejavu.`, `files.` and `rt.<DEPLOY_DOMAIN>`): set `DEPLOY_DOMAIN` in `.env`, then
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (realtime then runs under `wrangler dev`).
