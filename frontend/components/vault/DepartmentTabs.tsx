import { cn } from "@/lib/utils";
import type { Department } from "@/types/org";

interface DepartmentTabsProps {
  departments: Department[];
  activeId: string | null;
  counts: Record<string, number>;
  total: number;
  onSelect: (departmentId: string | null) => void;
}

/** Hairline tab strip with resolved-case counts; the same selection as the header switcher. */
export function DepartmentTabs({ departments, activeId, counts, total, onSelect }: DepartmentTabsProps) {
  const tabs = [
    { id: null, label: "All Departments", count: total },
    ...departments.map((d) => ({ id: d.id, label: d.name, count: counts[d.id] ?? 0 })),
  ];

  return (
    <div role="tablist" aria-label="Department" className="flex flex-wrap border-b">
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id ?? "ALL"}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "relative flex items-center gap-2 border-r px-4 py-3 text-sm hover:bg-surface-2",
              selected
                ? "font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-navy"
                : "text-muted-foreground",
            )}
          >
            {tab.label}
            <span className="micro-label border px-1.5 py-0.5 text-muted-foreground">{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}
