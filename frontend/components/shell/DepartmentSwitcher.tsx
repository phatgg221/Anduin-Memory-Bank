"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Department } from "@/types/org";

const ALL = "ALL";

interface DepartmentSwitcherProps {
  departments: Department[];
  /** null = All Departments. */
  activeId: string | null;
  onChange: (departmentId: string | null) => void;
  error?: string;
}

/** `[ All Departments ▾ ]` — the header's department context. Filters views; never restricts access. */
export function DepartmentSwitcher({ departments, activeId, onChange, error }: DepartmentSwitcherProps) {
  const active = departments.find((d) => d.id === activeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-9 gap-2 px-3", error && "border-destructive")}
          title={error ?? "Switch department view"}
        >
          <span aria-hidden className={cn("size-2", active ? "bg-navy" : "border border-navy")} />
          <span className="micro-label hidden text-muted-foreground xl:inline">Dept</span>
          <span className="max-w-28 truncate text-sm text-ink md:max-w-40 xl:max-w-64">{active?.name ?? "All Departments"}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="micro-label text-muted-foreground">Department view</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={activeId ?? ALL}
          onValueChange={(value) => onChange(value === ALL ? null : value)}
        >
          <DropdownMenuRadioItem value={ALL}>All Departments</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {departments.map((department) => (
            <DropdownMenuRadioItem key={department.id} value={department.id} className="gap-2">
              <span className="flex-1">{department.name}</span>
              <span className="micro-label text-muted-foreground">{department.code}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {error && <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
