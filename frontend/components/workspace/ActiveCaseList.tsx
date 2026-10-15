import { CalendarClock, ChevronRight } from "lucide-react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { deadlineLabel, SeverityBadge } from "@/components/cases/SeverityBadge";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@/types/rooms";

interface ActiveCaseListProps {
  cases: ThreadSummary[];
  departmentCodes: Record<string, string>;
  onOpen: (caseId: string) => void;
}

export function ActiveCaseList({ cases, departmentCodes, onOpen }: ActiveCaseListProps) {
  return (
    <section aria-label="Active case rooms" className="flex flex-col gap-3">
      <SectionLabel index={3}>Active case rooms · {cases.length}</SectionLabel>
      {cases.length === 0 ? (
        <p className="border px-4 py-6 text-sm text-muted-foreground">
          No open cases here yet. Paste an incoming problem on the left to open one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y border">
          {cases.map((c) => {
            const deadline = deadlineLabel(c.due_date);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="micro-label text-navy">{c.case_code}</span>
                      <SeverityBadge severity={c.severity} className="py-0" />
                      {[c.department_id, ...c.secondary_department_ids].map((id, i) => (
                        <span
                          key={id}
                          className={cn("micro-label px-1", i === 0 ? "bg-navy text-white" : "border text-muted-foreground")}
                        >
                          {departmentCodes[id] ?? id}
                        </span>
                      ))}
                    </span>
                    <span className="truncate text-sm text-ink">
                      {c.client_name ? `${c.client_name} · ` : ""}
                      {c.title}
                    </span>
                    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {c.top_match_code && (
                        <span>
                          Closest precedent {c.top_match_code} ({c.top_match_score}%)
                        </span>
                      )}
                      <span>
                        {c.message_count} message{c.message_count === 1 ? "" : "s"}
                      </span>
                      {deadline && (
                        <span className={cn("flex items-center gap-1", deadline.overdue && "text-destructive")}>
                          <CalendarClock className="size-3" aria-hidden />
                          {deadline.text}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
