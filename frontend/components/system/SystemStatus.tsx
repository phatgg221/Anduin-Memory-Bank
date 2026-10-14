import type { Health } from "@/types/system";

type CheckState = "up" | "down" | "checking";

const DOT: Record<CheckState, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  checking: "bg-zinc-400 animate-pulse",
};

interface SystemStatusProps {
  health: Health | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function SystemStatus({ health, isLoading, isError }: SystemStatusProps) {
  const state = (ok: boolean | undefined): CheckState =>
    isLoading ? "checking" : isError || !ok ? "down" : "up";

  const checks = [
    { label: "API (FastAPI via /api proxy)", state: state(!isError) },
    {
      label: "PostgreSQL + pgvector",
      state: state(health?.database),
      detail: health?.pgvector ? `v${health.pgvector}` : undefined,
    },
    { label: "Object storage (MinIO bucket)", state: state(health?.storage) },
  ];

  return (
    <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="mb-4 text-sm font-medium text-zinc-500">System status</h2>
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li key={check.label} className="flex items-center gap-3 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[check.state]}`} aria-hidden />
            <span>{check.label}</span>
            {check.detail && <span className="font-mono text-xs text-zinc-500">{check.detail}</span>}
            <span className="ml-auto font-mono text-xs uppercase text-zinc-500">{check.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
