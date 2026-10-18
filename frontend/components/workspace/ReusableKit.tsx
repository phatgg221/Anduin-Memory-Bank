import { Eye, FileText, Plus } from "lucide-react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { AlumniBadge } from "@/components/brand/StatusBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CaseFile, PrecedentDetail } from "@/types/rooms";

interface ReusableKitProps {
  precedents: PrecedentDetail[];
  ownFiles: CaseFile[];
  /** File ids already posted into this case's channel. */
  usedFileIds: Set<string>;
  canUse: boolean;
  onPreview: (fileId: string) => void;
  onUse: (file: { id: string; name: string; caseCode: string }) => void;
}

const STRONG_MATCH = 80;
const MATCH_FLOOR = 50;

/** `■ 03A / REUSABLE KIT` — deliverables rescued from the matched past cases, ready to reuse here. */
export function ReusableKit({ precedents, ownFiles, usedFileIds, canUse, onPreview, onUse }: ReusableKitProps) {
  const cited = new Set(
    precedents.flatMap((p) =>
      p.delta_items.filter((d) => d.status !== "NET_NEW" && d.source_artifact_id).map((d) => d.source_artifact_id),
    ),
  );
  const files = precedents
    .filter((p) => p.similarity_score >= MATCH_FLOOR)
    .flatMap((p, rank) =>
      p.artifacts
        .filter((a) => a.is_reusable && (cited.has(a.id) || rank === 0))
        .map((a) => ({ file: a, precedent: p, weak: !cited.has(a.id) && p.similarity_score < STRONG_MATCH })),
    )
    .sort((a, b) => Number(a.weak) - Number(b.weak));

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>03 / Reusable kit · {files.length}</SectionLabel>
      {files.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {precedents.length === 0
            ? "Run the analysis to pull reusable files from past cases."
            : "No reusable files from close enough matches."}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {files.map(({ file, precedent, weak }) => {
          const used = usedFileIds.has(file.id);
          const author = file.uploaded_by;
          return (
            <li key={file.id} className={cn("flex flex-col gap-2 border bg-background p-3", weak && "border-dashed")}>
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-mono text-xs text-ink" title={file.file_name}>
                    {file.file_name}
                  </span>
                  <span className="micro-label text-[10px] text-muted-foreground">{file.file_type}</span>
                </div>
              </div>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {precedent.case_code}
                {weak && (
                  <span
                    className="micro-label border px-1 text-[10px]"
                    title={`From a ${Math.round(precedent.similarity_score)}% match and not tied to any requirement in this request`}
                  >
                    Weak match
                  </span>
                )}
                {author && ` · ${author.name}`}
                {author && !author.is_active && <AlumniBadge>ALUMNI</AlumniBadge>}
              </span>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onPreview(file.id)}
                >
                  <Eye className="size-3.5" /> Preview
                </Button>
                {canUse && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={used}
                    onClick={() => onUse({ id: file.id, name: file.file_name, caseCode: precedent.case_code })}
                  >
                    <Plus className="size-3.5" /> {used ? "In case" : "Use in case"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {ownFiles.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="micro-label text-muted-foreground">Files on this case · {ownFiles.length}</span>
          <ul className="flex flex-col divide-y border bg-background">
            {ownFiles.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onPreview(file.id)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-mono text-xs text-ink">{file.file_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
