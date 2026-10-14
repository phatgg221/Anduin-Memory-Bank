import type { DeltaStatus } from "@/types/delta";
import { cn } from "@/lib/utils";

const STYLES: Record<DeltaStatus, { box: string; dot: string }> = {
  REUSABLE: { box: "border-reusable-border bg-reusable-bg text-reusable", dot: "bg-reusable-dot" },
  MODIFIED: { box: "border-modified-border bg-modified-bg text-modified", dot: "bg-modified-dot" },
  NET_NEW: { box: "border-net-new-border bg-net-new-bg text-net-new", dot: "bg-net-new-dot" },
};

/** `[■ REUSABLE]` / `[■ MODIFIED]` / `[■ NET_NEW]` — Delta Matrix status. */
export function StatusBadge({ status, className }: { status: DeltaStatus; className?: string }) {
  const style = STYLES[status];
  return (
    <span className={cn("micro-label inline-flex items-center gap-1.5 border px-1.5 py-0.5", style.box, className)}>
      <span aria-hidden className={cn("size-1.5", style.dot)} />
      {status}
    </span>
  );
}

/** `[■ ALUMNI ARCHIVE]` — knowledge authored by someone who has left. */
export function AlumniBadge({ children = "ALUMNI ARCHIVE", className }: { children?: string; className?: string }) {
  return (
    <span
      className={cn(
        "micro-label inline-flex items-center gap-1.5 border border-alumni-border bg-alumni-bg px-1.5 py-0.5 text-alumni",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 bg-alumni-dot" />
      {children}
    </span>
  );
}
