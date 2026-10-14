import { cn } from "@/lib/utils";

interface SimilarityMeterProps {
  /** 0–100, as computed by retrieval (never by the LLM). */
  score: number;
  rank?: number;
  className?: string;
}

/** `#01 · 94% MATCH` over a brand-cyan bar on a steel track. */
export function SimilarityMeter({ score, rank, className }: SimilarityMeterProps) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="micro-label text-ink">
        {rank !== undefined && `#${String(rank).padStart(2, "0")} · `}
        {value}% MATCH
      </span>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label="Similarity"
        className="h-0.5 w-full bg-surface-3"
      >
        <div className="h-full bg-brand-cyan" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
