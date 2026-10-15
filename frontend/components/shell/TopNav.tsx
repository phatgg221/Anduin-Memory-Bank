import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  /** Rendered but not clickable — for sections that aren't built yet. */
  disabled?: boolean;
}

interface TopNavProps {
  items: NavItem[];
  activeHref?: string;
  actions?: ReactNode;
}

/** Persistent top bar: `▲ Dejavu // by Anduin   Workbench   Knowledge Vault   Ingest Archive   [actions]` */
export function TopNav({ items, activeHref, actions }: TopNavProps) {
  const cell = "relative flex items-center border-r px-5 text-sm whitespace-nowrap";

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="flex h-14 items-stretch">
        <Link href="/" className="flex items-center border-r px-5 whitespace-nowrap hover:bg-surface-2">
          <BrandMark />
        </Link>
        <nav aria-label="Primary" className="flex items-stretch">
          {items.map((item) =>
            item.disabled ? (
              <span
                key={item.href}
                aria-disabled
                title="Not built yet"
                className={cn(cell, "cursor-not-allowed text-muted-foreground/50")}
              >
                {item.label}
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === activeHref ? "page" : undefined}
                className={cn(
                  cell,
                  "hover:bg-surface-2",
                  item.href === activeHref
                    ? "font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-navy"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
        {actions && <div className="ml-auto flex items-center gap-2 px-4">{actions}</div>}
      </div>
    </header>
  );
}
