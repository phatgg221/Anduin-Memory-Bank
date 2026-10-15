import { FileText, SquareArrowOutUpRight } from "lucide-react";
import { AlumniBadge, StatusBadge } from "@/components/brand/StatusBadge";
import { Button } from "@/components/ui/button";
import type { VaultCase } from "@/types/vault";

interface VaultCaseCardProps {
  item: VaultCase;
  /** department id → display code, e.g. LEGAL_COMPLIANCE → LEGAL */
  departmentCodes: Record<string, string>;
  onOpenArtifact: (artifactId: string) => void;
  openingArtifactId?: string;
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function VaultCaseCard({ item, departmentCodes, onOpenArtifact, openingArtifactId }: VaultCaseCardProps) {
  const lead = item.lead_resolver;
  const departments = [item.department_id, ...item.secondary_department_ids];

  return (
    <article className="flex min-w-0 flex-col border bg-background">
      <header className="flex flex-col gap-3 border-b p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro-label text-navy">{item.case_code}</span>
          {departments.map((id, index) => (
            <span
              key={id}
              className={
                index === 0
                  ? "micro-label bg-navy px-1.5 py-0.5 text-white"
                  : "micro-label border px-1.5 py-0.5 text-muted-foreground"
              }
            >
              {departmentCodes[id] ?? id}
            </span>
          ))}
          {item.resolved_at && (
            <span className="micro-label ml-auto text-muted-foreground">
              Resolved {MONTH.format(new Date(item.resolved_at))}
              {item.duration_days !== null && ` · ${item.duration_days}d`}
            </span>
          )}
        </div>
        <h3 className="text-base font-medium text-ink">{item.title}</h3>
        {lead && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden className="flex size-6 items-center justify-center bg-navy text-[10px] font-semibold text-white">
              {lead.avatar_initials}
            </span>
            <span className="text-ink">{lead.name}</span>
            {lead.job_title && <span className="text-muted-foreground">· {lead.job_title}</span>}
            {!lead.is_active && (
              <AlumniBadge>
                {lead.departed_at ? `ALUMNI · LEFT ${MONTH.format(new Date(lead.departed_at)).toUpperCase()}` : "ALUMNI"}
              </AlumniBadge>
            )}
          </div>
        )}
        {item.summary && <p className="text-sm text-muted-foreground">{item.summary}</p>}
        {Object.keys(item.context_tags).length > 0 && (
          <dl className="flex flex-wrap gap-1.5">
            {Object.entries(item.context_tags).map(([label, value]) => (
              <div key={label} className="flex border text-xs">
                <dt className="bg-surface-2 px-1.5 py-0.5 text-muted-foreground">{label}</dt>
                <dd className="px-1.5 py-0.5 text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <ul className="divide-y">
        {item.artifacts.map((artifact) => (
          <li key={artifact.id} className="flex items-center gap-3 px-5 py-2.5">
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-xs text-ink" title={artifact.file_name}>
                {artifact.file_name}
              </span>
              <span className="truncate text-xs text-muted-foreground" title={artifact.description}>
                {artifact.description}
              </span>
            </div>
            <span className="micro-label hidden text-muted-foreground sm:inline">
              {artifact.file_type} · {formatSize(artifact.size_bytes)}
            </span>
            {artifact.is_reusable && <StatusBadge status="REUSABLE" />}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open ${artifact.file_name}`}
              disabled={openingArtifactId === artifact.id}
              onClick={() => onOpenArtifact(artifact.id)}
            >
              <SquareArrowOutUpRight className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </article>
  );
}
