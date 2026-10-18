import { SectionLabel } from "@/components/brand/SectionLabel";
import type { CaseJob } from "@/types/memory";
import { JobProgress } from "./JobProgress";

/** Shown on a resolved thread: what was committed, and whether it's indexed for future matches yet. */
export function MemoryBanner({
  summary,
  resolvedAt,
  indexJob,
}: {
  summary: string | null;
  resolvedAt: string | null;
  indexJob: CaseJob | null;
}) {
  const date = resolvedAt
    ? new Date(resolvedAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })
    : null;
  return (
    <div className="flex flex-col gap-3 border-t bg-surface-2 px-6 py-4">
      <SectionLabel>Committed to memory{date && ` · ${date}`}</SectionLabel>
      {summary && <p className="text-sm text-ink">{summary}</p>}
      {indexJob && indexJob.status !== "COMPLETED" && (
        <JobProgress job={indexJob} title="Indexing for future matches" />
      )}
      {indexJob?.status === "COMPLETED" && (
        <p className="micro-label text-reusable">
          Indexed · {indexJob.result?.chunks ?? 0} chunks · searchable by future requests
        </p>
      )}
      <p className="text-xs text-muted-foreground">This thread is read-only now.</p>
    </div>
  );
}
