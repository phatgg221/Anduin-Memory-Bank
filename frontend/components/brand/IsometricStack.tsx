import { cn } from "@/lib/utils";

const plane = (cy: number) => `M120 ${cy - 52} L210 ${cy} L120 ${cy + 52} L30 ${cy} Z`;

/** Isometric line art for empty states: three stacked planes (steel) topped by a navy plane and cyan ring. */
export function IsometricStack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 220" fill="none" aria-hidden className={cn("h-auto w-48", className)}>
      <path
        d="M30 70 V150 M210 70 V150 M120 122 V202"
        className="stroke-surface-3"
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />
      <path d={plane(150)} className="fill-white stroke-surface-3" vectorEffect="non-scaling-stroke" />
      <path d={plane(110)} className="fill-white stroke-surface-3" vectorEffect="non-scaling-stroke" />
      <path d={plane(70)} className="fill-white stroke-navy" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <ellipse cx="120" cy="70" rx="42" ry="24" className="stroke-brand-cyan" strokeWidth={1.5} />
      <rect x="116" y="66" width="8" height="8" className="fill-navy" />
    </svg>
  );
}
