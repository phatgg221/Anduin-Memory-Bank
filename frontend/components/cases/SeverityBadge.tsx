import { cn } from "@/lib/utils";
import type { Severity } from "@/types/rooms";

const STYLES: Record<Severity, string> = {
  CRITICAL: "border-net-new-border bg-net-new-bg text-net-new",
  HIGH: "border-modified-border bg-modified-bg text-modified",
  MEDIUM: "border-navy/30 text-navy",
  LOW: "border text-muted-foreground",
};

export const SEVERITY_HELP: Record<Severity, string> = {
  CRITICAL: "A close, launch or client relationship is at risk now",
  HIGH: "Blocks a milestone or deadline",
  MEDIUM: "Needs attention this cycle",
  LOW: "Improvement or question, no deadline pressure",
};

/** `[■ CRITICAL]` — always a label, never colour alone. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn("micro-label inline-flex items-center gap-1.5 border px-1.5 py-0.5", STYLES[severity], className)}
    >
      <span aria-hidden className="size-1.5 bg-current" />
      {severity}
    </span>
  );
}

/** "in 12 days" / "due today" / "3 days overdue" — relative to today. */
export function deadlineLabel(dueDate: string | null): { text: string; overdue: boolean } | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${dueDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return { text: "due today", overdue: false };
  if (days > 0) return { text: `in ${days} day${days === 1 ? "" : "s"}`, overdue: false };
  return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true };
}
