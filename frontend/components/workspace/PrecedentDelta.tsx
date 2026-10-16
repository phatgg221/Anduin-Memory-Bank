"use client";

import { ArrowUpRight, MessagesSquare, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { SimilarityMeter } from "@/components/brand/SimilarityMeter";
import { AlumniBadge, StatusBadge } from "@/components/brand/StatusBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CaseJob } from "@/types/memory";
import type { PrecedentDetail } from "@/types/rooms";
import { InvestigationScreen } from "./InvestigationScreen";

interface PrecedentDeltaProps {
  precedents: PrecedentDetail[];
  departmentCodes: Record<string, string>;
  analysis: CaseJob | null;
  onRunAnalysis?: () => void;
  isStarting: boolean;
  onOpenFile: (fileId: string) => void;
  onOpenVault: () => void;
  onOpenChannel: () => void;
  header?: ReactNode;
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });

/** `■ PRECEDENT & DELTA ENGINE` — top-3 matches, how the selected one went, and what's different this time. */
export function PrecedentDelta({
  precedents,
  departmentCodes,
  analysis,
  onRunAnalysis,
  isStarting,
  onOpenFile,
  onOpenVault,
  onOpenChannel,
  header,
}: PrecedentDeltaProps) {
  const [selected, setSelected] = useState(0);
  const running = analysis?.status === "QUEUED" || analysis?.status === "PROCESSING";

  if (running || (analysis?.status === "FAILED" && precedents.length === 0)) {
    return <InvestigationScreen job={analysis!} onRetry={onRunAnalysis} isRetrying={isStarting} />;
  }
  if (precedents.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          No precedents matched yet. Dejavu compares this request with every case in the Memory Bank and shows the top 3,
          how they went and what&apos;s different this time.
        </p>
        {onRunAnalysis && (
          <Button onClick={onRunAnalysis} disabled={isStarting}>
            {isStarting ? "Starting…" : "Run Dejavu analysis"}
          </Button>
        )}
      </div>
    );
  }

  const current = precedents[Math.min(selected, precedents.length - 1)];
  const lead = current.lead;
  const firstFile = current.artifacts.find((a) => a.is_reusable) ?? current.artifacts[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      {header}
      <section className="flex flex-col gap-3">
        <SectionLabel>Top {precedents.length} historical matches</SectionLabel>
        <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-3" role="tablist" aria-label="Matched past cases">
          {precedents.map((precedent, index) => (
            <button
              key={precedent.case_code}
              type="button"
              role="tab"
              aria-selected={index === selected}
              onClick={() => setSelected(index)}
              className={cn(
                "flex min-w-0 flex-col gap-2 border p-3 text-left",
                index === selected ? "border-navy bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <SimilarityMeter score={precedent.similarity_score} rank={index + 1} />
              <span className="micro-label text-muted-foreground">{precedent.case_code}</span>
              <span className="line-clamp-2 text-sm text-ink">{precedent.title}</span>
              <span className="flex flex-wrap items-center gap-1">
                {[precedent.department_id, ...precedent.secondary_department_ids].filter(Boolean).map((id) => (
                  <span key={id} className="micro-label border px-1 text-[10px] text-muted-foreground">
                    {departmentCodes[id!] ?? id}
                  </span>
                ))}
              </span>
              {precedent.lead_name && (
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {precedent.lead_name}
                  {precedent.lead_is_alumni && <AlumniBadge>ALUMNI</AlumniBadge>}
                </span>
              )}
            </button>
          ))}
        </div>
        {analysis?.result?.guard_warnings && analysis.result.guard_warnings.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Source check: {analysis.result.guard_warnings.length} unverifiable reference(s) removed.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 bg-navy p-5 text-white">
        <SectionLabel inverse>How {current.case_code} went</SectionLabel>
        {lead && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{lead.name}</span>
            {lead.job_title && <span className="text-white/70">— {lead.job_title}</span>}
            {!lead.is_active && (
              <span className="micro-label border border-white/40 px-1.5 py-0.5 text-white">
                ■ Alumni{lead.departed_at && ` · left ${MONTH.format(new Date(lead.departed_at))}`}
              </span>
            )}
          </p>
        )}
        {current.duration_days !== null && (
          <p className="micro-label text-white/70">
            Took {current.duration_days} days{current.resolved_at && ` · resolved ${MONTH.format(new Date(current.resolved_at))}`}
          </p>
        )}
        <p className="text-sm leading-relaxed text-white/90">“{current.how_past_case_went}”</p>
        {current.pitfall_warnings.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-white/20 pt-3">
            {current.pitfall_warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2 text-xs text-white/90">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={onOpenVault} className="micro-label flex items-center gap-1 border border-white/40 px-2 py-1 hover:bg-white/10">
            View in Knowledge Vault <ArrowUpRight className="size-3" />
          </button>
          {firstFile && (
            <button
              type="button"
              onClick={() => onOpenFile(firstFile.id)}
              className="micro-label flex items-center gap-1 border border-white/40 px-2 py-1 hover:bg-white/10"
            >
              Inspect {firstFile.file_name.length > 28 ? `${firstFile.file_name.slice(0, 27)}…` : firstFile.file_name} <ArrowUpRight className="size-3" />
            </button>
          )}
          <button type="button" onClick={onOpenChannel} className="micro-label flex items-center gap-1 border border-white/40 px-2 py-1 hover:bg-white/10">
            <MessagesSquare className="size-3" /> Discuss in case channel
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>What&apos;s different this time · delta matrix</SectionLabel>
        {current.delta_items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No delta items for this precedent.</p>
        ) : (
          <div className="overflow-x-auto border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="bg-surface-2">
                <tr>
                  {["Operational dimension", "Past case spec", "Current request spec", "Delta status & action"].map((h) => (
                    <th key={h} className="micro-label border-b px-3 py-2 font-normal text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.delta_items.map((item) => (
                  <tr key={`${item.category}-${item.status}`} className="border-b align-top last:border-b-0">
                    <td className="px-3 py-2.5 font-medium text-ink">{item.category}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{item.past_approach}</td>
                    <td className="px-3 py-2.5 text-ink">{item.current_requirement}</td>
                    <td className="flex flex-col items-start gap-1.5 px-3 py-2.5">
                      <StatusBadge status={item.status} />
                      <span className="text-xs text-muted-foreground">{item.action_recommendation}</span>
                      {item.source_artifact && item.source_artifact_id && (
                        <button
                          type="button"
                          onClick={() => onOpenFile(item.source_artifact_id!)}
                          className="max-w-full truncate font-mono text-[11px] text-navy underline-offset-2 hover:underline"
                        >
                          {item.source_artifact}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {onRunAnalysis && (
          <Button variant="ghost" size="sm" className="w-fit" onClick={onRunAnalysis} disabled={isStarting}>
            Re-run analysis with the latest details
          </Button>
        )}
      </section>
    </div>
  );
}
