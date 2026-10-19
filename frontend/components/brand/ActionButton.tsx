import type { ComponentProps } from "react";
import { ArrowUpRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ICONS = { arrow: ArrowUpRight, bolt: Zap };

type ActionButtonProps = Omit<ComponentProps<typeof Button>, "variant" | "size" | "asChild"> & {
  /** primary: ink fill + white icon box. secondary: white fill, 1px ink border + ink icon box. */
  tone?: "primary" | "secondary";
  icon?: keyof typeof ICONS;
};

/** `[ Run Dejavu Analysis  [↗] ]` — Corvane's action button with the boxed arrow. */
export function ActionButton({ tone = "primary", icon = "arrow", className, children, ...props }: ActionButtonProps) {
  const Icon = ICONS[icon];
  const primary = tone === "primary";

  return (
    <Button
      variant={primary ? "default" : "outline"}
      className={cn(
        "h-10 justify-between gap-4 pr-1 pl-4 text-sm font-medium",
        !primary && "border-ink hover:bg-surface-2",
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      <span
        aria-hidden
        className={cn("flex size-8 items-center justify-center", primary ? "bg-white text-ink" : "bg-ink text-white")}
      >
        <Icon className="size-4" />
      </span>
    </Button>
  );
}
