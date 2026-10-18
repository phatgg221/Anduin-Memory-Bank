# Deploying Dejavu

| Piece | Runs on | Notes |
|---|---|---|
| Frontend (Next.js) | **Vercel** | `/api/*` is rewritten to the Cloud Run URL, so the browser stays same-origin and the refresh cookie works |
| Backend (FastAPI + job worker) | **Google Cloud Run** | 1 instance, CPU always on: the job worker and sweeper run inside the API process |
| Postgres + pgvector | **Neon** | Migrations run on every backend start |
| File storage | **Cloudflare R2** | S3 API; presigned links are https |
| Realtime | **PartyKit** (`partykit deploy`) | Browsers connect over wss; the API publishes over https |

Everything reads one file, `deploy/prod.env` (gitignored), through `bun run deploy <step>`.
Pick the same region everywhere (default: Singapore — `asia-southeast1`, Neon `aws-ap-southeast-1`, Vercel `sin1`).

Cost: Vercel Hobby, Neon, R2 and PartyKit are free at this scale. Cloud Run with an always-on 1 vCPU / 1 GiB
instance is about $45–55/month; a new GCP account's $300 credit covers it.

## 0. Accounts and CLIs (once)

- **Google Cloud**: a project with billing on. Install the CLI (`brew install --cask google-cloud-sdk`), then
  `gcloud auth login` and
  `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project <id>`.
- **Neon**: a project in the same region. Copy the **direct** connection string (not the `-pooler` host).
- **Cloudflare R2**: a bucket (e.g. `dejavu`) and an R2 API token with Object Read & Write on it. Note the
  account id, access key id and secret.
- **PartyKit**: `cd realtime && bunx partykit login` (GitHub sign-in).
- **Vercel**: `vercel login`.
- **OpenRouter**: set a monthly spending limit on the key you'll use.

## 1. Configure

```bash
bun run deploy init
```

This creates `deploy/prod.env` with fresh `JWT_SECRET` / `REALTIME_SECRET`. Fill in `GCP_PROJECT`, `DATABASE_URL`, the
R2 values (`MINIO_*`) and the LLM keys. Neon's `postgresql://…?sslmode=require` URL works as is.

## 2. Deploy, in this order

```bash
bun run deploy realtime   # prints the PartyKit host → put it in REALTIME_HOST
bun run deploy backend    # builds backend/Dockerfile on Cloud Build, deploys dejavu-api, prints its URL
bun run deploy seed       # demo data + files into Neon and R2; Cloud Run's worker then embeds the cases
bun run deploy frontend   # links the Vercel project (first run), sets its env vars, deploys to production
```

`deploy frontend` sets three Vercel env vars: `BACKEND_INTERNAL_URL` (Cloud Run URL), `NEXT_PUBLIC_REALTIME_HOST`
and `JWT_SECRET` (must match the backend's). The first two are baked in at build time, so a change needs a redeploy.

Then register on the live site, put your email in `SEED_OPERATOR_EMAIL`, and run `bun run deploy seed` again
(it's idempotent).

## 3. Check

- `https://<vercel-domain>/api/health` → database and storage `true`.
- Sign in, reload: still signed in (secure refresh cookie).
- Open a kit file: the link is `https://<account-id>.r2.cloudflarestorage.com/…`.
- Two browsers: a message appears live in the other (wss to PartyKit).
- Upload an intake PDF of a few MB: Vercel's proxy has request-size limits, so test the largest file you'll demo.

## Updating

Re-run the step for what changed: `bun run deploy backend` or `bun run deploy frontend` (or connect the GitHub repo
to the Vercel project with root directory `frontend/` for deploys on push).

## Alternative: one VM

`docker-compose.prod.yml` + `Caddyfile` run the whole stack on a single Linux VM behind Caddy (HTTPS on
`dejavu.`, `files.` and `rt.<DEPLOY_DOMAIN>`): set `DEPLOY_DOMAIN` in `.env`, then
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
