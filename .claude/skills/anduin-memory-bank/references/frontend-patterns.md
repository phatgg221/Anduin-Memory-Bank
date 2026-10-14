# Frontend Patterns — Next.js 16 · React Query v5 · Axios

Screens, components, and type shapes below are **illustrative** — the feature set and API contract aren't final. The *layering* is not negotiable.

## Layout

```text
frontend/
├── next.config.ts
├── app/
│   ├── layout.tsx                  # wraps children in <Providers>
│   ├── providers.tsx               # "use client" — QueryClientProvider
│   ├── page.tsx                    # Intake workbench
│   ├── triage/[jobId]/page.tsx     # Progress → Top 3, how-it-went, Delta Matrix
│   └── vault/
│       ├── page.tsx                # Browse historical cases
│       └── [caseId]/page.tsx       # Case detail
├── components/                     # presentational only
│   ├── triage/                     # IntakeDropzone, BriefChips, MatchCard, DeltaMatrix, PitfallList, JobProgress
│   ├── vault/                      # CaseHeader, ArtifactList, PersonTag
│   └── ui/                         # SimilarityBadge, StatusPill, AlumniBadge, SplitPane
├── store/                          # queryKeys.ts, triage.ts, vault.ts
├── services/                       # triageService.ts, vaultService.ts
├── lib/axiosClient.ts
└── types/                          # triage.ts, vault.ts
```

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

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,        // keep on (default; mandatory next major) — see dynamic routes below
  partialPrefetching: true,
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
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
export type TriageStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type DeltaStatus = "REUSABLE" | "MODIFIED" | "NET_NEW";

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

## `app/providers.tsx`

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

## Page containers

```tsx
// app/page.tsx — intake
"use client";

import { useRouter } from "next/navigation";
import { IntakeDropzone } from "@/components/triage/IntakeDropzone";
import { useCreateTriage } from "@/store/triage";

export default function IntakePage() {
  const router = useRouter();
  const createTriage = useCreateTriage();

  return (
    <IntakeDropzone
      isSubmitting={createTriage.isPending}
      error={createTriage.error?.message}
      onSubmit={(input) =>
        createTriage.mutate(input, { onSuccess: ({ job_id }) => router.push(`/triage/${job_id}`) })
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
// app/triage/[jobId]/loading.tsx — required; also the first paint
import { JobProgress } from "@/components/triage/JobProgress";

export default function Loading() {
  return <JobProgress status="QUEUED" />;
}
```

```tsx
// app/triage/[jobId]/page.tsx — params is a Promise in Next.js 16
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

```tsx
// components/ui/StatusPill.tsx — props in, nothing else
import type { DeltaStatus } from "@/types/triage";

const TONE: Record<DeltaStatus, "green" | "amber" | "red"> = {
  REUSABLE: "green",
  MODIFIED: "amber",
  NET_NEW: "red",
};

const LABEL: Record<DeltaStatus, string> = {
  REUSABLE: "Reusable",
  MODIFIED: "Modified",
  NET_NEW: "Net-new risk",
};

export function StatusPill({ status }: { status: DeltaStatus }) {
  return <span data-tone={TONE[status]}>{LABEL[status]}</span>;
}
```

Interactive components take callbacks, e.g. `ArtifactList({ artifacts, onOpen, onDownload })`. The page wires those callbacks to `useArtifactLink`.

Styling (Tailwind or otherwise, design tokens, layout) will be defined in `DESIGN.md`, which isn't written yet.
