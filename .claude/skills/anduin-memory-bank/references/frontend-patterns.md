# Frontend Patterns — Next.js 16 · React Query v5 · Axios

Screens, components, and type shapes below are **illustrative** — the feature set and API contract aren't final. The *layering* is not negotiable.

## Layout

```text
frontend/
├── next.config.ts                  # / → /workbench redirect, /api rewrite, standalone, Cache Components
├── components.json                 # shadcn config (radix base, nova style)
├── app/
│   ├── layout.tsx                  # fonts, <Providers>, Suspense-wrapped RoutedTopNav, <main>
│   ├── providers.tsx               # "use client" — QueryClientProvider + TooltipProvider
│   ├── globals.css                 # Dejavu tokens (see design-system.md)
│   ├── workbench/page.tsx          # ✓ 3-pane frame (01 request · 02 precedent & delta · 03 kit & source)
│   ├── workbench/[jobId]/          # proposed: the same 3 panes, filled from a triage job (+ loading.tsx)
│   ├── vault/page.tsx              # proposed: stats strip + case table
│   ├── vault/[caseId]/             # proposed: case detail (+ loading.tsx)
│   └── ingest/page.tsx             # proposed: Ingest Archive (needs product sign-off)
├── components/                     # presentational only (ESLint-enforced)
│   ├── ui/                         # ✓ shadcn/ui primitives (owned code)
│   ├── brand/                      # ✓ SectionLabel, ActionButton, StatusBadge/AlumniBadge, SimilarityMeter, BrandMark, IsometricStack
│   ├── shell/                      # ✓ TopNav, RoutedTopNav
│   ├── system/                     # ✓ SystemStatus (status bar)
│   ├── triage/                     # IntakeForm, BriefParams, MatchStrip, HowItWent, DeltaMatrix, JobProgress
│   └── vault/                      # VaultStats, CaseTable, ArtifactList, CitationInspector
├── store/                          # queryKeys.ts, system.ts ✓, triage.ts, vault.ts
├── services/                       # systemService.ts ✓, triageService.ts, vaultService.ts
├── lib/                            # axiosClient.ts ✓, utils.ts (cn) ✓
└── types/                          # system.ts ✓, delta.ts ✓ (DeltaStatus), triage.ts, vault.ts
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

## `lib/axiosClient.ts`

```ts
import axios from "axios";

// Relative base URL: browser-only. Never call services from Server Components.
export const axiosClient = axios.create({ baseURL: "/api", timeout: 30_000 });
```

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

`QueryClientProvider` (staleTime 30 s, retry 1) wrapping shadcn's `TooltipProvider`. Add new app-wide providers here, not in `layout.tsx` (which is a Server Component).

## `app/layout.tsx` — the shell

- The nav is configured as a `NAV: NavItem[]` array. Items whose route doesn't exist yet get `disabled: true`.
- `RoutedTopNav` calls `usePathname`, which **suspends on routes with unknown dynamic params** under Cache Components. It is therefore wrapped in `<Suspense fallback={<TopNav items={NAV} />}>`, which keeps the shell prerendered. Keep that wrapper when you touch the layout.
- Pages render inside `<main className="flex flex-1 flex-col">`, so **pages must not render their own `<main>`**.

## Page containers

```tsx
// app/workbench/page.tsx — intake (pane 01) wired to a mutation; results live at /workbench/[jobId]
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
// app/workbench/[jobId]/loading.tsx — required; also the first paint
import { JobProgress } from "@/components/triage/JobProgress";

export default function Loading() {
  return <JobProgress status="QUEUED" />;
}
```

```tsx
// app/workbench/[jobId]/page.tsx — params is a Promise in Next.js 16
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
