import { cn } from "@/lib/utils";

export function Avatar({ initials, muted, className }: { initials: string; muted?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center text-[10px] font-semibold",
        muted ? "border bg-surface-2 text-muted-foreground" : "bg-navy text-white",
        className,
      )}
    >
      {initials}
    </span>
  );
}
