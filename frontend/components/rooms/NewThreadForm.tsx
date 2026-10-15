"use client";

import { useState, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Department } from "@/types/org";

export interface NewThreadValues {
  title: string;
  initial_request_brief: string;
  secondary_department_ids: string[];
}

interface NewThreadFormProps {
  department: Department;
  departments: Department[];
  onSubmit: (values: NewThreadValues) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Opens a new case: it becomes a sub-chat of this room and of every department it involves. */
export function NewThreadForm({ department, departments, onSubmit, onCancel, isSubmitting, error, fieldErrors = {} }: NewThreadFormProps) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [involved, setInvolved] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim().length < 3) return setLocalError("Give the case a title of at least 3 characters.");
    if (brief.trim().length < 10) return setLocalError("Describe the request in at least 10 characters.");
    setLocalError(null);
    onSubmit({ title: title.trim(), initial_request_brief: brief.trim(), secondary_department_ids: involved });
  };

  const toggle = (id: string, checked: boolean) =>
    setInvolved((current) => (checked ? [...current, id] : current.filter((d) => d !== id)));

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-2">
        <SectionLabel>New case thread · {department.code}</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Opens a case with its own sub-chat. It&apos;s listed under {department.name} and every department you involve,
          and it&apos;s what &quot;Resolve &amp; Commit to Memory&quot; will summarize later.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="thread-title">Title</Label>
        <Input
          id="thread-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Bain Capital Tech Opportunities V — Parallel Fund Onboarding"
          maxLength={200}
          aria-invalid={Boolean(fieldErrors.title)}
        />
        {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="thread-brief">Incoming request</Label>
        <Textarea
          id="thread-brief"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="What arrived: the client, the fund, the deadline and what they need."
          rows={5}
          maxLength={4000}
          aria-invalid={Boolean(fieldErrors.initial_request_brief)}
        />
        {fieldErrors.initial_request_brief && (
          <p className="text-xs text-destructive">{fieldErrors.initial_request_brief}</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">Also involve</legend>
        {departments
          .filter((d) => d.id !== department.id)
          .map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm text-ink">
              <Checkbox checked={involved.includes(d.id)} onCheckedChange={(checked) => toggle(d.id, checked === true)} />
              {d.name}
              <span className="micro-label text-muted-foreground">{d.code}</span>
            </label>
          ))}
      </fieldset>

      {(localError ?? error) && (
        <p role="alert" className="border border-destructive px-3 py-2 text-sm text-destructive">
          {localError ?? error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <ActionButton type="submit" className="w-56" disabled={isSubmitting}>
          {isSubmitting ? "Opening…" : "Open case thread"}
        </ActionButton>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
