"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SUGGESTED = ["Jurisdiction", "Fund Structure", "Workflow", "Regulation", "Investor Type", "Tax Form", "Integration"];
const MAX_TAGS = 8;

interface TagEditorProps {
  value: Record<string, string>;
  onChange: (tags: Record<string, string>) => void;
}

/** Key/value context tags (Title Case labels). They feed search and the AI summary. */
export function TagEditor({ value, onChange }: TagEditorProps) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));

  const emit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()])));
  };
  const usedKeys = new Set(rows.map(([k]) => k));

  return (
    <div className="flex flex-col gap-2">
      {rows.map(([key, val], index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="h-8 w-40 text-xs"
            value={key}
            placeholder="Label"
            aria-label={`Tag ${index + 1} label`}
            onChange={(e) => emit(rows.map((r, i) => (i === index ? [e.target.value, r[1]] : r)))}
          />
          <Input
            className="h-8 flex-1 text-xs"
            value={val}
            placeholder="Value, e.g. Cayman Islands"
            aria-label={`Tag ${index + 1} value`}
            onChange={(e) => emit(rows.map((r, i) => (i === index ? [r[0], e.target.value] : r)))}
          />
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove tag ${index + 1}`} onClick={() => emit(rows.filter((_, i) => i !== index))}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {rows.length < MAX_TAGS && (
        <div className="flex flex-wrap items-center gap-1.5">
          {SUGGESTED.filter((k) => !usedKeys.has(k)).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => emit([...rows, [key, ""]])}
              className="micro-label border px-1.5 py-0.5 text-muted-foreground hover:bg-surface-2 hover:text-ink"
            >
              + {key}
            </button>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => emit([...rows, ["", ""]])}>
            <Plus className="size-3" /> Custom
          </Button>
        </div>
      )}
    </div>
  );
}
