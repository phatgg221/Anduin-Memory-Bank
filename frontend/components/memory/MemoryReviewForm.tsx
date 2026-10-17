"use client";

import { BookMarked, Check, FileText, GitCompareArrows, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CASE_OUTCOMES,
  type CaseOutcome,
  type CommitInput,
  type CuratorSuggestions,
  type MemoryPitfall,
  type MemoryRecord,
  type Severity,
} from "@/types/memory";
import type { CaseFile, LinkedFile } from "@/types/rooms";

interface MemoryReviewFormProps {
  draft: MemoryRecord;
  provider: string;
  guardWarnings: string[];
  outcome: CaseOutcome;
  finalOutput: string;
  files: (CaseFile | LinkedFile)[];
  curator?: CuratorSuggestions;
  onCaseClick: (code: string) => void;
  onCommit: (input: CommitInput) => void;
  onRegenerate: () => void;
  onChangeOutcome: () => void;
  isCommitting: boolean;
  error?: string;
}

export function MemoryReviewForm({
  draft,
  provider,
  guardWarnings,
  outcome,
  finalOutput,
  files,
  curator,
  onCaseClick,
  onCommit,
  onRegenerate,
  onChangeOutcome,
  isCommitting,
  error,
}: MemoryReviewFormProps) {
  const [record, setRecord] = useState<MemoryRecord>(draft);
  const [ending, setEnding] = useState<{ outcome: CaseOutcome; finalOutput: string }>({ outcome, finalOutput });
  const suggested = new Map((curator?.reusable_files ?? []).map((f) => [f.artifact_id, f.reason]));
  const [reusable, setReusable] = useState<string[]>(() =>
    files.filter((f) => f.is_reusable || suggested.has(f.id)).map((f) => f.id),
  );
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
    if (ending.finalOutput.trim().length < 10) return setLocalError("Describe the final output in at least a sentence.");
    setLocalError(null);
    if (!confirming) return setConfirming(true);
    onCommit({
      ...record,
      resolution_steps: steps,
      outcome: ending.outcome,
      final_output: ending.finalOutput.trim(),
      reusable_file_ids: reusable,
    });
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

      <section className="flex flex-col gap-3 border border-navy p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel as="h3">Outcome</SectionLabel>
          <Button type="button" variant="ghost" size="sm" onClick={onChangeOutcome}>
            Change & redraft
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CASE_OUTCOMES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={ending.outcome === option.id}
              title={option.hint}
              onClick={() => setEnding((e) => ({ ...e, outcome: option.id }))}
              className={cn(
                "micro-label border px-2 py-1",
                ending.outcome === option.id ? "border-navy bg-navy text-white" : "text-muted-foreground hover:bg-surface-2",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Label htmlFor="memory-final-output" className="micro-label text-muted-foreground">
          Final output
        </Label>
        <Textarea
          id="memory-final-output"
          rows={2}
          value={ending.finalOutput}
          onChange={(e) => setEnding((x) => ({ ...x, finalOutput: e.target.value }))}
        />
      </section>

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

      <section className="flex flex-col gap-2">
        <SectionLabel as="h3">Add to the Knowledge Base</SectionLabel>
        <p className="text-xs text-muted-foreground">
          Checked files become reusable: they show up in the Reusable kit of every future case that matches this one.
        </p>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">This case has no files.</p>
        ) : (
          <ul className="flex flex-col divide-y border">
            {files.map((file) => {
              const checked = reusable.includes(file.id);
              const reason = suggested.get(file.id);
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() =>
                      setReusable((ids) => (ids.includes(file.id) ? ids.filter((x) => x !== file.id) : [...ids, file.id]))
                    }
                    className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                        checked ? "border-navy bg-navy text-white" : "bg-background",
                      )}
                    >
                      {checked && <Check className="size-3" aria-hidden />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate font-mono text-xs text-ink">{file.file_name}</span>
                        {reason && <span className="micro-label shrink-0 text-reusable">Dejavu suggests</span>}
                        {"source_case_code" in file && (
                          <span className="micro-label shrink-0 text-muted-foreground">
                            Reused from {file.source_case_code}
                          </span>
                        )}
                        {file.file_type === "CLIENT_APPROVAL" && (
                          <span className="micro-label shrink-0 text-muted-foreground">Client approval</span>
                        )}
                      </span>
                      {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel as="h3">Consistency with older cases</SectionLabel>
        {!curator ? (
          <p className="text-sm text-muted-foreground">Not checked for this draft.</p>
        ) : curator.contradictions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink">
            <Check className="size-4 text-reusable" aria-hidden />
            No conflicts with {curator.checked_cases.length ? curator.checked_cases.join(", ") : "related memory"}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {curator.contradictions.map((c) => (
              <li key={c.case_code + c.existing} className="flex flex-col gap-1 border-l-2 border-modified bg-modified-bg px-3 py-2">
                <span className="flex items-center gap-2">
                  <GitCompareArrows className="size-3.5 text-modified" aria-hidden />
                  <button type="button" onClick={() => onCaseClick(c.case_code)} className="micro-label text-navy hover:underline">
                    {c.case_code}
                  </button>
                </span>
                <span className="text-xs text-ink">
                  <span className="text-muted-foreground">Older memory:</span> {c.existing}
                </span>
                <span className="text-xs text-ink">
                  <span className="text-muted-foreground">This case:</span> {c.new}
                </span>
                <span className="text-xs text-muted-foreground">{c.explanation}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(localError ?? error) && (
        <p role="alert" className="border border-destructive px-3 py-2 text-sm text-destructive">
          {localError ?? error}
        </p>
      )}

      {confirming && !localError && (
        <p className="border border-navy px-3 py-2 text-sm text-ink">
          Committing resolves the case, makes its thread read-only and adds it to the Knowledge Base with{" "}
          {reusable.length} reusable file{reusable.length === 1 ? "" : "s"}. Press again to confirm.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <ActionButton type="button" className="w-80" onClick={commit} disabled={isCommitting}>
          <span className="flex items-center gap-1.5">
            <BookMarked className="size-4" aria-hidden />
            {isCommitting ? "Committing…" : confirming ? "Confirm: add to Knowledge Base" : "Commit to Knowledge Base"}
          </span>
        </ActionButton>
        <Button type="button" variant="ghost" onClick={onRegenerate} disabled={isCommitting}>
          Regenerate draft
        </Button>
      </div>
    </div>
  );
}
