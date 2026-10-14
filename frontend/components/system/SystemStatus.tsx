import { SectionLabel } from "@/components/brand/SectionLabel";
import { cn } from "@/lib/utils";
import type { Health } from "@/types/system";

type CheckState = "up" | "down" | "checking";

const DOT: Record<CheckState, string> = {
  up: "bg-reusable-dot",
  down: "bg-net-new-dot",
  checking: "bg-surface-3 animate-pulse",
};

interface SystemStatusProps {
  health: Health | undefined;
  isLoading: boolean;
  isError: boolean;
}

/** Slim status bar: `■ SYSTEM   ■ API   ■ POSTGRES + PGVECTOR v0.8.7   ■ STORAGE` */
export function SystemStatus({ health, isLoading, isError }: SystemStatusProps) {
  const state = (ok: boolean | undefined): CheckState =>
    isLoading ? "checking" : isError || !ok ? "down" : "up";

  const checks = [
    { label: "API", state: state(!isError) },
    {
      label: "Postgres + pgvector",
      state: state(health?.database),
      detail: health?.pgvector ? `v${health.pgvector}` : undefined,
    },
    { label: "Storage", state: state(health?.storage) },
  ];

  return (
    <footer className="flex h-9 items-center gap-6 border-t bg-background px-6">
      <SectionLabel as="p">System</SectionLabel>
      <ul className="flex items-center gap-5">
        {checks.map((check) => (
          <li key={check.label} className="micro-label flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className={cn("size-1.5", DOT[check.state])} />
            <span>{check.label}</span>
            {check.detail && <span className="text-ink">{check.detail}</span>}
            <span className="sr-only">{check.state}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
