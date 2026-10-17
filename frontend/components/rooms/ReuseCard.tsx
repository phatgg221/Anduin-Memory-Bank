import { FileText } from "lucide-react";
import { AlumniBadge } from "@/components/brand/StatusBadge";
import { GuardWarnings } from "@/components/workspace/GuardWarnings";
import { cn } from "@/lib/utils";
import type { ReusePayload, ReviewCitation } from "@/types/rooms";
import { Citation } from "./ReviewCard";

const VERDICTS: Record<ReusePayload["verdict"], { label: string; className: string }> = {
  READY: { label: "Ready to use", className: "border-reusable-border bg-reusable-bg text-reusable" },
  ADAPT: { label: "Adapt first", className: "border-modified-border bg-modified-bg text-modified" },
  CAUTION: { label: "Use with caution", className: "border-destructive bg-background text-destructive" },
};

function Sources({ citations, onOpen }: { citations: ReviewCitation[]; onOpen: (c: ReviewCitation) => void }) {
  if (citations.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {citations.map((citation, index) => (
        <Citation key={index} citation={citation} onOpen={onOpen} />
      ))}
    </div>
  );
}

interface ReuseCardProps {
  brief: ReusePayload;
  onOpenCitation: (citation: ReviewCitation) => void;
  onOpenFile: (artifactId: string) => void;
  onCaseClick?: (caseCode: string) => void;
}

export function ReuseCard({ brief, onOpenCitation, onOpenFile, onCaseClick }: ReuseCardProps) {
  const { file } = brief;
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="micro-label text-navy">Reuse brief</span>
        <span className={cn("micro-label border px-1.5 py-0.5", VERDICTS[brief.verdict].className)}>
          {VERDICTS[brief.verdict].label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => onOpenFile(file.artifact_id)}
          className="flex items-center gap-1.5 border bg-background px-1.5 py-0.5 font-mono text-ink hover:bg-surface-3"
        >
          <FileText className="size-3 text-muted-foreground" aria-hidden />
          {file.file_name}
        </button>
        from
        <button
          type="button"
          onClick={() => onCaseClick?.(file.case_code)}
          className="border px-1 font-mono text-navy hover:bg-surface-3"
        >
          {file.case_code}
        </button>
        {file.lead_name && <span>· built by {file.lead_name}</span>}
        {file.lead_alumni && <AlumniBadge>ALUMNI</AlumniBadge>}
      </div>
      <p className="text-sm text-ink">{brief.what_it_is}</p>
      <div className="flex flex-col gap-1">
        <span className="micro-label text-muted-foreground">Why it fits this case</span>
        <p className="text-sm text-ink">{brief.fit}</p>
      </div>
      {brief.changes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="micro-label text-muted-foreground">Change before using</span>
          <ol className="flex flex-col divide-y border bg-background">
            {brief.changes.map((item, index) => (
              <li key={index} className="flex gap-2 p-2.5">
                <span className="micro-label mt-0.5 text-navy">{index + 1}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{item.change}</span>
                  <span className="text-sm text-muted-foreground">{item.why}</span>
                  <Sources citations={item.citations} onOpen={onOpenCitation} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {brief.watch_outs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="micro-label text-muted-foreground">Watch out</span>
          <ul className="flex flex-col gap-1.5 border-l-2 border-modified pl-3">
            {brief.watch_outs.map((item, index) => (
              <li key={index} className="flex flex-col gap-0.5 text-sm text-ink">
                {item.warning}
                <Sources citations={item.citations} onOpen={onOpenCitation} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Checked against {brief.sources_checked} source{brief.sources_checked === 1 ? "" : "s"}: the file&apos;s pages
        and this case&apos;s files · sources and pages are set by code, not the model
      </p>
      <GuardWarnings warnings={brief.guard_warnings} prefix="Source check: " />
    </div>
  );
}
