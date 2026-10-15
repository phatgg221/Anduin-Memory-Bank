import { Check, Circle, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaseJob } from "@/types/memory";

/** Step-by-step job progress (never a bare spinner). */
export function JobProgress({ job, title }: { job: CaseJob; title: string }) {
  const current = job.step ? job.steps.indexOf(job.step) : -1;
  const done = job.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-3 border p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="micro-label text-navy">{title}</span>
        <span className="micro-label text-muted-foreground">
          {job.status === "QUEUED" ? "Queued" : job.status === "PROCESSING" ? "Working" : job.status.toLowerCase()}
          {job.attempts > 1 && ` · attempt ${job.attempts}`}
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {job.steps.map((step, index) => {
          const state = done || index < current ? "done" : index === current && job.status === "PROCESSING" ? "active" : "todo";
          return (
            <li key={step} className={cn("flex items-center gap-2 text-sm", state === "todo" ? "text-muted-foreground" : "text-ink")}>
              {state === "done" ? (
                <Check className="size-4 text-reusable" aria-hidden />
              ) : state === "active" ? (
                <LoaderCircle className="size-4 animate-spin text-navy" aria-hidden />
              ) : (
                <Circle className="size-4" aria-hidden />
              )}
              {step}
            </li>
          );
        })}
      </ol>
      {job.status === "FAILED" && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          {job.error ?? "The job failed."}
        </p>
      )}
    </div>
  );
}
