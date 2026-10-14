import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionLabelProps {
  children: ReactNode;
  /** Renders as `01 /` before the label. */
  index?: number;
  as?: "h1" | "h2" | "h3" | "p";
  /** White square + text, for navy surfaces. */
  inverse?: boolean;
  className?: string;
}

/** `■ 01 / INCOMING REQUEST` — the overline on every pane and section. */
export function SectionLabel({ children, index, as: Tag = "h2", inverse = false, className }: SectionLabelProps) {
  return (
    <Tag className={cn("micro-label flex items-center gap-2", inverse ? "text-white" : "text-navy", className)}>
      <span aria-hidden className={cn("size-2 shrink-0", inverse ? "bg-white" : "bg-navy")} />
      {index !== undefined && <span>{String(index).padStart(2, "0")} /</span>}
      <span>{children}</span>
    </Tag>
  );
}
