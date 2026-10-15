import { cn } from "@/lib/utils";

interface TabBarProps<T extends string> {
  tabs: { id: T; label: string }[];
  active: T;
  onSelect: (tab: T) => void;
  label: string;
}

export function TabBar<T extends string>({ tabs, active, onSelect, label }: TabBarProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 overflow-x-auto border-b">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            "micro-label relative flex shrink-0 items-center gap-2 border-r px-4 py-3 hover:bg-surface-2",
            active === item.id
              ? "text-navy after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-navy"
              : "text-muted-foreground",
          )}
        >
          <span aria-hidden className={cn("size-1.5", active === item.id ? "bg-navy" : "bg-hairline")} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
