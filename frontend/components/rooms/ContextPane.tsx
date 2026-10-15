import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { SimilarityMeter } from "@/components/brand/SimilarityMeter";
import { AlumniBadge } from "@/components/brand/StatusBadge";
import type { PinnedCase } from "@/types/rooms";

/** `■ 03 / DEJAVU CONTEXT` — the pinned problem and how its closest past cases went. */
export function ContextPane({ pinned }: { pinned: PinnedCase | null }) {
  return (
    <section className="flex flex-col gap-5 p-6">
      <SectionLabel index={3}>Dejavu context</SectionLabel>
      {!pinned ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <IsometricStack />
          <p className="text-sm text-muted-foreground">Pin a case to see its closest past cases here.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="micro-label text-navy">{pinned.case_code}</span>
            <h3 className="text-sm font-medium text-ink">{pinned.title}</h3>
            <p className="line-clamp-4 text-xs text-muted-foreground">{pinned.initial_request_brief}</p>
          </div>
          {pinned.precedents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No precedents computed for this case yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {pinned.precedents.map((precedent, index) => (
                <li key={precedent.case_code} className="flex flex-col gap-2 border p-3">
                  <SimilarityMeter score={precedent.similarity_score} rank={index + 1} />
                  <span className="micro-label text-muted-foreground">{precedent.case_code}</span>
                  <span className="text-sm text-ink">{precedent.title}</span>
                  {precedent.lead_name && (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {precedent.lead_name}
                      {precedent.lead_is_alumni && <AlumniBadge>ALUMNI</AlumniBadge>}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">{precedent.how_past_case_went}</p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
