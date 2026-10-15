import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface PanelToggleProps {
  label: string;
  pressed: boolean;
  onClick: () => void;
  badge?: number;
  children: ReactNode;
}

export function PanelToggle({ label, pressed, onClick, badge = 0, children }: PanelToggleProps) {
  return (
    <Button
      variant={pressed ? "secondary" : "ghost"}
      size="icon"
      className="relative size-8 shrink-0"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {children}
      {badge > 0 && (
        <span className="micro-label absolute -top-1 -right-1 bg-navy px-1 text-[10px] text-white">{badge}</span>
      )}
    </Button>
  );
}
