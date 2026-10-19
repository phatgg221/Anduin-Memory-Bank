import { cn } from "@/lib/utils";

/** `▲ Dejavu // by Corvane`. `inverse` for navy surfaces. */
export function BrandMark({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span aria-hidden className="text-sm text-brand-cyan">
        ▲
      </span>
      <span className={cn("text-base font-semibold tracking-tight", inverse ? "text-white" : "text-ink")}>Dejavu</span>
      <span className={cn("micro-label", inverse ? "text-white/60" : "text-muted-foreground")}>{"// by Corvane"}</span>
    </span>
  );
}
