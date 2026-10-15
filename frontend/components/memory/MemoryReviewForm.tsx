"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryPitfall, MemoryRecord, Severity } from "@/types/memory";

interface MemoryReviewFormProps {
  draft: MemoryRecord;
  provider: string;
  guardWarnings: string[];
  onCommit: (record: MemoryRecord) => void;
  onRegenerate: () => void;
  isCommitting: boolean;
  error?: string;
}

/** Human review before anything is stored: every field of the drafted Case Memory Record is editable. */
export function MemoryReviewForm({ draft, provider, guardWarnings, onCommit, onRegenerate, isCommitting, error }: MemoryReviewFormProps) {
  const [record, setRecord] = useState<MemoryRecord>(draft);
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof MemoryRecord>(key: K, value: MemoryRecord[K]) => setRecord((r) => ({ ...r, [key]: value }));
  const setStep = (index: number, value: string) =>
    set("resolution_steps", record.resolution_steps.map((s, i) => (i === index ? value : s)));
  const setPitfall = (index: number, patch: Partial<MemoryPitfall>) =>
    set("pitfalls", record.pitfalls.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const commit = () => {
    const steps = record.resolution_steps.map((s) => s.trim()).filter(Boolean);
    if (record.summary.trim().length < 20) return setLocalError("The summary needs at least 20 characters.");
    if (record.how_it_went.trim().length < 20) return setLocalError("“How it went” needs at least 20 characters.");
    if (steps.length === 0) return setLocalError("Add at least one resolution step.");
    if (record.pitfalls.some((p) => p.warning.trim().length < 10)) return setLocalError("Each pitfall needs at least 10 characters.");
    setLocalError(null);
    if (!confirming) return setConfirming(true);
    onCommit({ ...record, resolution_steps: steps });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="micro-label text-navy">Draft memory record</span>
        <span>· written by {provider}</span>
        <span>· review and edit before committing</span>
      </div>

      {guardWarnings.length > 0 && (
        <div className="flex flex-col gap-1 border border-modified-border bg-modified-bg px-3 py-2 text-xs text-modified">
          <span className="micro-label">Citation check</span>
          {guardWarnings.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="memory-summary">Summary</Label>
        <Textarea id="memory-summary" rows={3} value={record.summary} onChange={(e) => set("summary", e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="memory-how">How it went</Label>
        <Textarea id="memory-how" rows={5} value={record.how_it_went} onChange={(e) => set("how_it_went", e.target.value)} />
      </div>

      <section className="flex flex-col gap-2">
        <SectionLabel as="h3">Resolution steps</SectionLabel>
        {record.resolution_steps.map((step, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="micro-label mt-2.5 w-6 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
            <Textarea rows={2} value={step} onChange={(e) => setStep(index, e.target.value)} aria-label={`Step ${index + 1}`} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove step ${index + 1}`}
              onClick={() => set("resolution_steps", record.resolution_steps.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="w-fit gap-1.5" onClick={() => set("resolution_steps", [...record.resolution_steps, ""])}>
          <Plus className="size-4" /> Add step
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel as="h3">Pitfalls for the next team</SectionLabel>
        {record.pitfalls.length === 0 && <p className="text-sm text-muted-foreground">No pitfalls drafted.</p>}
        {record.pitfalls.map((pitfall, index) => (
          <div key={index} className="flex flex-col gap-2 border p-3">
            <Textarea rows={2} value={pitfall.warning} onChange={(e) => setPitfall(index, { warning: e.target.value })} aria-label={`Pitfall ${index + 1}`} />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={pitfall.severity} onValueChange={(value) => setPitfall(index, { severity: value as Severity })}>
                <SelectTrigger className="h-8 w-32" aria-label="Severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["HIGH", "MEDIUM", "LOW"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 w-48 font-mono text-xs"
                value={pitfall.reference ?? ""}
                placeholder="Chat #L12 or a file name"
                onChange={(e) => setPitfall(index, { reference: e.target.value || null })}
                aria-label="Source reference"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label={`Remove pitfall ${index + 1}`}
                onClick={() => set("pitfalls", record.pitfalls.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit gap-1.5"
          onClick={() => set("pitfalls", [...record.pitfalls, { warning: "", severity: "MEDIUM", reference: null }])}
        >
          <Plus className="size-4" /> Add pitfall
        </Button>
      </section>

      {Object.keys(record.context_tags).length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionLabel as="h3">Context tags</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(record.context_tags).map(([label, value]) => (
              <span key={label} className="flex items-center border text-xs">
                <span className="bg-surface-2 px-1.5 py-0.5 text-muted-foreground">{label}</span>
                <span className="px-1.5 py-0.5 text-ink">{value}</span>
                <button
                  type="button"
                  aria-label={`Remove tag ${label}`}
                  className="px-1 text-muted-foreground hover:text-ink"
                  onClick={() => set("context_tags", Object.fromEntries(Object.entries(record.context_tags).filter(([k]) => k !== label)))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {(localError ?? error) && (
        <p role="alert" className="border border-destructive px-3 py-2 text-sm text-destructive">
          {localError ?? error}
        </p>
      )}

      {confirming && !localError && (
        <p className="border border-navy px-3 py-2 text-sm text-ink">
          Committing resolves the case and makes its thread read-only. The record is then indexed for future matches.
          Press commit again to confirm.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <ActionButton type="button" className="w-64" onClick={commit} disabled={isCommitting}>
          {isCommitting ? "Committing…" : confirming ? "Confirm: commit to memory" : "Commit to memory"}
        </ActionButton>
        <Button type="button" variant="ghost" onClick={onRegenerate} disabled={isCommitting}>
          Regenerate draft
        </Button>
      </div>
    </div>
  );
}
