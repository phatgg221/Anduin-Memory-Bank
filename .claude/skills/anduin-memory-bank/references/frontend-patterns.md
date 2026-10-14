# Frontend Patterns — Next.js 16 · React Query v5 · Axios

Screens, components, and type shapes below are **illustrative** — the feature set and API contract aren't final. The *layering* is not negotiable.

## Layout

```text
frontend/
├── next.config.ts                  # / → /workbench redirect, /api rewrite, standalone, Cache Components
├── components.json                 # shadcn config (radix base, nova style)
├── app/
│   ├── layout.tsx                  # ✓ fonts + <Providers> only (shells live in the route groups)
│   ├── providers.tsx               # ✓ QueryClient + TooltipProvider; session-expiry → session null
│   ├── globals.css                 # ✓ Dejavu tokens (see design-system.md)
│   ├── (auth)/                     # ✓ public: AuthFrame split layout (proxy bounces signed-in users)
│   │   ├── login/page.tsx          # ✓
│   │   └── register/page.tsx       # ✓
│   └── (app)/                      # ✓ signed-in only: session gate + TopNav/UserMenu + <main>
│       ├── workbench/page.tsx      # ✓ 3-pane frame (01 request · 02 precedent & delta · 03 kit & source)
│       ├── workbench/[jobId]/      # proposed: the same 3 panes, filled from a triage job (+ loading.tsx)
│       ├── vault/page.tsx          # proposed: stats strip + case table
│       ├── vault/[caseId]/         # proposed: case detail (+ loading.tsx)
│       └── ingest/page.tsx         # proposed: Ingest Archive (needs product sign-off)
├── components/                     # presentational only (ESLint-enforced)
│   ├── ui/                         # ✓ shadcn/ui primitives (owned code)
│   ├── brand/                      # ✓ SectionLabel, ActionButton, StatusBadge/AlumniBadge, SimilarityMeter, BrandMark, IsometricStack
│   ├── shell/                      # ✓ TopNav, RoutedTopNav, UserMenu
│   ├── auth/                       # ✓ AuthFrame, LoginForm, RegisterForm, FormAlert, SessionSplash
│   ├── system/                     # ✓ SystemStatus (status bar)
│   ├── triage/                     # IntakeForm, BriefParams, MatchStrip, HowItWent, DeltaMatrix, JobProgress
│   └── vault/                      # VaultStats, CaseTable, ArtifactList, CitationInspector
├── store/                          # queryKeys.ts ✓, auth.ts ✓, system.ts ✓, triage.ts, vault.ts
├── services/                       # authService.ts ✓, systemService.ts ✓, triageService.ts, vaultService.ts
├── proxy.ts                        # ✓ page-level auth gate (default-deny)
├── lib/                            # axiosClient.ts ✓ (+ refresh interceptor), accessToken.ts ✓, apiError.ts ✓, sessionCookie.ts ✓, safeRedirect.ts ✓, utils.ts ✓
└── types/                          # auth.ts ✓, system.ts ✓, delta.ts ✓ (DeltaStatus), triage.ts, vault.ts
```

✓ = exists today. Route and component names for unbuilt features are proposals.

## Import rules

| Layer | May import | Must not import |
|---|---|---|
| `app/**/page.tsx` | `store/`, `components/`, `types/`, `next/*` | `services/`, `lib/axiosClient` |
| `store/` | `services/`, `types/`, `@tanstack/react-query` | `components/`, axios |
| `services/` | `lib/axiosClient`, `types/` | React, `store/`, `components/` |
| `components/` | other `components/`, `types/` | `store/`, `services/`, axios |

ESLint (`frontend/eslint.config.mjs`) enforces this table and bans `fetch`. `bun run lint` must pass.

## `next.config.ts` (as committed)

```ts
import type { NextConfig } from "next";

const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
const projectRoot = __dirname; // the repo-root bun.lock would otherwise make Next treat the monorepo as root

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  cacheComponents: true,        // keep on (default; mandatory next major) — see dynamic routes below
  partialPrefetching: true,
  turbopack: { root: projectRoot, rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  async redirects() {
    return [{ source: "/", destination: "/workbench", permanent: false }];
  },
  async rewrites() {
    // Resolved at build time for production builds — the Dockerfile passes it as a build arg.
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
```

## `lib/axiosClient.ts` + auth plumbing (as committed)

- **`axiosClient`:** `baseURL: "/api"` (browser-only). A request interceptor adds `Authorization: Bearer <token>` from `accessTokenStore`.
- **401 handling:** on a 401 from any request without `skipAuthRefresh`, the response interceptor:
  1. calls `refreshSession()` — **one shared request** for all concurrent 401s, retried once on `409 refresh_token_rotated`;
  2. replays the original request once (`authRetried`);
  3. if the refresh itself returns 401, calls `accessTokenStore.expire()`. Providers listen, set the session to `null`, and the `(app)` gate redirects to `/login`.
- **`lib/accessToken.ts`:** the access token lives in memory only (`get`/`set`/`expire`/`onExpired`). Never put it in localStorage or a readable cookie.
- **`lib/apiError.ts`:** services wrap calls in `withApiErrors(...)`, which normalises FastAPI errors into `ApiRequestError { message, status, fieldErrors }`.
  - `{detail: "…"}` → `message`.
  - 422 `{detail: [{loc, msg}]}` → `fieldErrors[field]`.
  - Forms show `fieldErrors` under each field and `message` in a `FormAlert`.
- **Auth endpoints** (`/auth/login|register|refresh|logout`) pass `{ skipAuthRefresh: true }`: a 401 there means bad credentials, not an expired token.

### Session hooks (`store/auth.ts`)

| Hook | Does |
|---|---|
| `useSession()` | `Session \| null`. Restores once per page load via `/auth/refresh` (`staleTime: Infinity`) |
| `useLogin()` / `useRegister()` | `mutate(input)`; on success the session cache is set, and the `(auth)` layout redirects to `/workbench` |
| `useLogout()` | Revokes the server session, drops user-scoped caches, sets the session to `null` → `(app)` redirects to `/login` |

New signed-in pages go under `app/(app)/`. They can assume a session, but must not render their own `<main>`.

### `proxy.ts` — page-level gate (Next 16 Proxy, Node runtime)

- **Default-deny:** every page matched needs a valid `dejavu_refresh` cookie except `AUTH_PAGES` (`/login`, `/register`).
  - Signed out → `307 /login?next=<path+query>`, and an invalid cookie is deleted.
  - Signed in on an auth page → redirect to the sanitised `?next=` or `/workbench`.
- **Optimistic only:** `lib/sessionCookie.ts` verifies signature, expiry, and `type=refresh` with `jose` and `JWT_SECRET` (read at request time). **Never add DB or API calls here**: proxy runs on every route and prefetch.
  - Revoked tokens are caught when `(app)` restores the session: `/api/auth/refresh` returns 401, clears the cookie, and the layout sends the user to `/login`.
- **Matcher** skips `/api/*` (FastAPI authenticates itself), `/_next/*`, `/__nextjs*`, and paths with a file extension. Keep it that way when editing.
- **After login/register,** pages call `router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")))`. Read `window.location` in the callback rather than `useSearchParams`, which would need a Suspense boundary under Cache Components.
- **Always run `?next=` through `safeNextPath`** (`lib/safeRedirect.ts`). It resolves the value with the URL parser and requires the same origin. Hand-rolled prefix checks miss `/\t/evil.com`.

## `types/triage.ts` (illustrative — keep in sync with backend `schemas.py`)

```ts
export type { DeltaStatus } from "./delta"; // already exists: "REUSABLE" | "MODIFIED" | "NET_NEW"
export type TriageStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface TriageJob {
  id: string;
  status: TriageStatus;
  step: string | null;            // e.g. "EXTRACTING" | "RETRIEVING" | "COMPARING" | "VALIDATING"
  result: TriageResult | null;
  error: string | null;
}

export interface CreateTriageInput {
  text?: string;
  files?: File[];
}
```

Once the API settles, consider generating these from `/api/openapi.json` with `openapi-typescript` instead of hand-syncing them.

## `services/triageService.ts`

```ts
import { axiosClient } from "@/lib/axiosClient";
import type { CreateTriageInput, TriageJob } from "@/types/triage";

export const triageService = {
  async create(input: CreateTriageInput): Promise<{ job_id: string }> {
    const form = new FormData();
    if (input.text) form.append("text", input.text);
    input.files?.forEach((file) => form.append("files", file));
    const { data } = await axiosClient.post<{ job_id: string }>("/triage", form);
    return data;
  },

  async get(jobId: string): Promise<TriageJob> {
    const { data } = await axiosClient.get<TriageJob>(`/triage/${jobId}`);
    return data;
  },
};
```

The service owns transport details (FormData, URLs); components only see `CreateTriageInput`.

## `store/queryKeys.ts`

```ts
export const queryKeys = {
  triage: {
    all: ["triage"] as const,
    job: (jobId: string) => ["triage", "job", jobId] as const,
  },
  vault: {
    cases: (filters?: Record<string, string>) => ["vault", "cases", filters ?? {}] as const,
    case: (caseId: string) => ["vault", "case", caseId] as const,
  },
};
```

## `store/triage.ts` — polling that stops itself

```ts
import { useMutation, useQuery } from "@tanstack/react-query";
import { triageService } from "@/services/triageService";
import type { TriageStatus } from "@/types/triage";
import { queryKeys } from "./queryKeys";

const ACTIVE: TriageStatus[] = ["QUEUED", "PROCESSING"];

export function useTriageJob(jobId: string) {
  return useQuery({
    queryKey: queryKeys.triage.job(jobId),
    queryFn: () => triageService.get(jobId),
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const status = query.state.data?.status;
      return status && !ACTIVE.includes(status) ? false : 2_000;
    },
  });
}

export function useCreateTriage() {
  return useMutation({ mutationFn: triageService.create });
}
```

## `store/vault.ts` — presigned links on demand

```ts
export function useArtifactLink() {
  // A mutation, not a query: presigned URLs expire, so fetch a fresh one per click.
  return useMutation({
    mutationFn: (args: { artifactId: string; disposition: "inline" | "attachment" }) =>
      vaultService.getArtifactLink(args.artifactId, args.disposition),
  });
}
```

The page decides what to do with the URL. For `attachment`, use `window.location.assign(url)` — it downloads without leaving the page. For `inline`, use `window.open(url, "_blank", "noopener")`.

## `app/providers.tsx` (as committed)

- **Providers:** `QueryClientProvider` (staleTime 30 s, retry 1) wrapping shadcn's `TooltipProvider`.
- **Session expiry:** subscribes to `accessTokenStore.onExpired` to null the session.
- Add new app-wide providers here, not in `layout.tsx` (which is a Server Component).

## `app/(app)/layout.tsx` — the signed-in shell

- **Session gate:** a client layout that calls `useSession()` and does `router.replace("/login")` once the session is known to be `null`.
- **Always render `{children}`** — inside `<div hidden={!user}>`, behind `SessionSplash` until the user is known. If a layout returns a splash *instead of* its children, Cache Components' instant-navigation validation flags the page as a "dropped segment". `export const instant = false` doesn't fix that, and can't be exported from a Client Component anyway.
- **Nav:** configured as a `NAV: NavItem[]` array; items whose route doesn't exist yet get `disabled: true`. The `UserMenu` goes in the TopNav `actions` slot.
- **Keep the Suspense wrapper:** `RoutedTopNav` calls `usePathname`, which **suspends on routes with unknown dynamic params**, so it's wrapped in `<Suspense fallback={<TopNav … />}>`.
- **Pages** render inside `<main className="flex flex-1 flex-col">`, so **they must not render their own `<main>`**.

## Page containers

```tsx
// app/(app)/workbench/page.tsx — intake (pane 01) wired to a mutation; results live at /workbench/[jobId]
"use client";

import { useRouter } from "next/navigation";
import { IntakeForm } from "@/components/triage/IntakeForm";
import { useCreateTriage } from "@/store/triage";

export default function WorkbenchPage() {
  const router = useRouter();
  const createTriage = useCreateTriage();

  return (
    <IntakeForm
      isSubmitting={createTriage.isPending}
      error={createTriage.error?.message}
      onSubmit={(input) =>
        createTriage.mutate(input, { onSuccess: ({ job_id }) => router.push(`/workbench/${job_id}`) })
      }
    />
  );
}
```

### Dynamic routes need a `loading.tsx` (Cache Components)

With Cache Components on, reading `params` outside a Suspense boundary fails `next build` with:

> Route "/…/[id]": Next.js encountered uncached or runtime data during prerendering.

`next dev` stays silent about this. Every dynamic segment therefore ships a `loading.tsx`. Next wraps the page in a Suspense boundary from it, and it doubles as the skeleton. With it in place, the route builds as a Partial Prerender (◐).

```tsx
// app/(app)/workbench/[jobId]/loading.tsx — required; also the first paint
import { JobProgress } from "@/components/triage/JobProgress";

export default function Loading() {
  return <JobProgress status="QUEUED" />;
}
```

```tsx
// app/(app)/workbench/[jobId]/page.tsx — params is a Promise in Next.js 16
"use client";

import { use } from "react";
import { JobProgress } from "@/components/triage/JobProgress";
import { TriageResultView } from "@/components/triage/TriageResultView";
import { useTriageJob } from "@/store/triage";

export default function TriageJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const job = useTriageJob(jobId);

  if (job.isPending) return <JobProgress status="QUEUED" />;
  if (job.isError) return <JobProgress status="FAILED" error={job.error.message} />;

  const { status, step, result, error } = job.data;
  if (status === "FAILED") return <JobProgress status="FAILED" error={error ?? undefined} />;
  if (status !== "COMPLETED" || !result) return <JobProgress status={status} step={step} />;
  return <TriageResultView result={result} />;
}
```

## Presentational component

Feature components compose shadcn primitives with the brand kit. Props in, callbacks out, no data access:

```tsx
// components/triage/DeltaMatrix.tsx
import { SectionLabel } from "@/components/brand/SectionLabel";
import { StatusBadge } from "@/components/brand/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DeltaStatus } from "@/types/delta";

interface DeltaRow {
  category: string;
  pastApproach: string;
  currentRequirement: string;
  status: DeltaStatus;
}

export function DeltaMatrix({ rows }: { rows: DeltaRow[] }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionLabel>What&apos;s different this time</SectionLabel>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="micro-label">Dimension</TableHead>
            <TableHead className="micro-label">Past case</TableHead>
            <TableHead className="micro-label">This request</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.category}>
              <TableCell className="font-medium">{row.category}</TableCell>
              <TableCell className="text-muted-foreground">{row.pastApproach}</TableCell>
              <TableCell className="flex items-center justify-between gap-3">
                {row.currentRequirement}
                <StatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
```

Interactive components take callbacks, e.g. `ArtifactList({ artifacts, onPreview, onExport })`. The page wires those callbacks to `useArtifactLink`.

Styling rules, tokens, and the brand kit are in `design-system.md`.
