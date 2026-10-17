import { CornerLeftUp, FileText, MessageSquareText, ScrollText } from "lucide-react";
import { GuardWarnings } from "@/components/workspace/GuardWarnings";
import { cn } from "@/lib/utils";
import type { ReviewCitation, ReviewPayload, ReviewVerdict } from "@/types/rooms";

const VERDICTS: Record<ReviewVerdict, { label: string; className: string }> = {
  SUPPORTED: { label: "Matches past work", className: "border-reusable-border bg-reusable-bg text-reusable" },
  CONFLICTS: { label: "Conflicts", className: "border-destructive bg-background text-destructive" },
  NO_PRECEDENT: { label: "No precedent", className: "border-net-new-border bg-net-new-bg text-net-new" },
  MISSING: { label: "Missing", className: "border-modified-border bg-modified-bg text-modified" },
};
const ORDER: ReviewVerdict[] = ["CONFLICTS", "MISSING", "NO_PRECEDENT", "SUPPORTED"];
const WHEN = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const when = (value: string) => (Number.isNaN(Date.parse(value)) ? value : WHEN.format(new Date(value)));

export function Citation({ citation, onOpen }: { citation: ReviewCitation; onOpen: (c: ReviewCitation) => void }) {
  const Icon = citation.artifact_id ? FileText : citation.message_id ? MessageSquareText : ScrollText;
  return (
    <button
      type="button"
      onClick={() => onOpen(citation)}
      title={citation.quote}
      className="flex max-w-full items-center gap-1.5 border bg-background px-1.5 py-0.5 text-left text-xs hover:bg-surface-3"
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-mono text-navy">{citation.this_case ? "This case" : citation.case_code}</span>
      <span className="truncate text-ink">{citation.label}</span>
    </button>
  );
}

interface ReviewCardProps {
  review: ReviewPayload;
  onOpenCitation: (citation: ReviewCitation) => void;
  onJump: (messageIds: string[]) => void;
}

export function ReviewCard({ review, onOpenCitation, onJump }: ReviewCardProps) {
  const findings = [...review.findings].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="micro-label text-navy">Solution review</span>
        <button
          type="button"
          onClick={() => onJump(review.range.message_ids ?? [review.range.from_message_id, review.range.to_message_id])}
          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
        >
          <CornerLeftUp className="size-3" aria-hidden />
          {review.range.count} message{review.range.count === 1 ? "" : "s"} · {when(review.range.from_at)} →{" "}
          {when(review.range.to_at)}
        </button>
      </div>
      {review.focus && <p className="text-xs text-muted-foreground">Focus: {review.focus}</p>}
      <p className="text-sm text-ink">{review.overall}</p>
      <div className="flex flex-wrap gap-1.5">
        {ORDER.filter((v) => review.counts[v]).map((verdict) => (
          <span key={verdict} className={cn("micro-label border px-1.5 py-0.5", VERDICTS[verdict].className)}>
            {review.counts[verdict]} {VERDICTS[verdict].label}
          </span>
        ))}
      </div>
      <ol className="flex flex-col divide-y border bg-background">
        {findings.map((finding, index) => (
          <li key={index} className="flex flex-col gap-1.5 p-3">
            <div className="flex items-start gap-2">
              <span className={cn("micro-label shrink-0 border px-1.5 py-0.5", VERDICTS[finding.verdict].className)}>
                {VERDICTS[finding.verdict].label}
              </span>
              <span className="text-sm font-medium text-ink">{finding.claim}</span>
            </div>
            <p className="text-sm text-ink">{finding.comment}</p>
            {(finding.citations.length > 0 || finding.message_ids.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {finding.citations.map((citation, index) => (
                  <Citation key={index} citation={citation} onOpen={onOpenCitation} />
                ))}
                {finding.message_ids.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onJump(finding.message_ids)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
                  >
                    Show in chat
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
        {findings.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">No concrete proposals found in those messages.</li>
        )}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        Checked against {review.sources_checked} source{review.sources_checked === 1 ? "" : "s"} in the Memory Bank and
        this case&apos;s files · sources and pages are set by code, not the model
      </p>
      <GuardWarnings warnings={review.guard_warnings} prefix="Source check: " />
    </div>
  );
}
