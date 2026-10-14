import { cn } from "@/lib/utils";

/** `▲ Dejavu // by Anduin` */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span aria-hidden className="text-sm text-brand-cyan">
        ▲
      </span>
      <span className="text-base font-semibold tracking-tight text-ink">Dejavu</span>
      <span className="micro-label text-muted-foreground">{"// by Anduin"}</span>
    </span>
  );
}
