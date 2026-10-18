"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Department } from "@/types/org";
import { SEVERITIES, SOURCE_TYPES, type CaseIntake, type RoomPerson } from "@/types/rooms";
import { SEVERITY_HELP } from "./SeverityBadge";
import { TagEditor } from "./TagEditor";

interface CaseIntakeFieldsProps {
  value: CaseIntake;
  onChange: (value: CaseIntake) => void;
  people: RoomPerson[];
  departments: Department[];
  /** The owning department: always involved, not a checkbox. */
  ownerDepartmentId: string;
  fieldErrors?: Record<string, string>;
  idPrefix: string;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

/** The case intake fields, shared by "New case thread" and "Edit details". */
export function CaseIntakeFields({
  value,
  onChange,
  people,
  departments,
  ownerDepartmentId,
  fieldErrors = {},
  idPrefix,
}: CaseIntakeFieldsProps) {
  const set = <K extends keyof CaseIntake>(key: K, v: CaseIntake[K]) => onChange({ ...value, [key]: v });
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="@container flex flex-col gap-6">
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("client")}>Customer</Label>
          <Input
            id={id("client")}
            value={value.client_name}
            onChange={(e) => set("client_name", e.target.value)}
            placeholder="Bain Capital"
            maxLength={200}
            aria-invalid={Boolean(fieldErrors.client_name)}
          />
          <FieldError message={fieldErrors.client_name} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("title")}>Case title</Label>
          <Input
            id={id("title")}
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Tech Opportunities V — Parallel Fund Onboarding"
            maxLength={200}
            aria-invalid={Boolean(fieldErrors.title)}
          />
          <FieldError message={fieldErrors.title} />
        </div>
      </div>

      <div className="grid gap-4 @xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("fund")}>Parent project / fund</Label>
          <Input
            id={id("fund")}
            value={value.fund_name ?? ""}
            onChange={(e) => set("fund_name", e.target.value || null)}
            placeholder="Crossover Feeder II (Cayman master-feeder)"
            maxLength={200}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink">How it arrived</legend>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_TYPES.map((source) => (
              <button
                key={source.id}
                type="button"
                aria-pressed={value.source_type === source.id}
                onClick={() => set("source_type", value.source_type === source.id ? null : source.id)}
                className={cn(
                  "micro-label border px-2 py-1",
                  value.source_type === source.id
                    ? "border-navy bg-navy text-white"
                    : "text-muted-foreground hover:bg-surface-2",
                )}
              >
                {source.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={id("problem")}>Problem &amp; context</Label>
        <p className="text-xs text-muted-foreground">
          What arrived, what&apos;s broken or required, what&apos;s at stake (dates, money, investors) and any
          constraints.
        </p>
        <Textarea
          id={id("problem")}
          rows={5}
          value={value.initial_request_brief}
          onChange={(e) => set("initial_request_brief", e.target.value)}
          placeholder="Bain is launching a Delaware parallel fund for its Tech Opportunities V close on 1 Dec. Pension LPs are expected, so the ERISA 25% aggregate cap must be tracked across both vehicles, and LP records come from DealCloud…"
          maxLength={4000}
          aria-invalid={Boolean(fieldErrors.initial_request_brief)}
        />
        <FieldError message={fieldErrors.initial_request_brief} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">Severity</legend>
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          {SEVERITIES.map((severity) => (
            <label
              key={severity}
              className={cn(
                "flex cursor-pointer flex-col gap-1 border p-2.5 text-left",
                value.severity === severity ? "border-navy bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <input
                type="radio"
                name={id("severity")}
                value={severity}
                checked={value.severity === severity}
                onChange={() => set("severity", severity)}
                className="sr-only"
              />
              <span className="micro-label text-ink">{severity}</span>
              <span className="text-xs text-muted-foreground">{SEVERITY_HELP[severity]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 @xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("due")}>Deadline</Label>
          <Input
            id={id("due")}
            type="date"
            value={value.due_date ?? ""}
            onChange={(e) => set("due_date", e.target.value || null)}
          />
          <p className="text-xs text-muted-foreground">The client date this works against (close, go-live, RFP due).</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("owner")}>Owner</Label>
          <Select value={value.lead_user_id ?? undefined} onValueChange={(v) => set("lead_user_id", v)}>
            <SelectTrigger id={id("owner")} className="w-full">
              <SelectValue placeholder="You" />
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                  {person.job_title && <span className="text-muted-foreground"> · {person.job_title}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Accountable for resolving the case and committing it to memory.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Context tags</span>
        <p className="text-xs text-muted-foreground">Used to match this case with past ones and to find it later.</p>
        <TagEditor value={value.context_tags} onChange={(tags) => set("context_tags", tags)} />
        <FieldError message={fieldErrors.context_tags} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">Also involve</legend>
        {departments
          .filter((d) => d.id !== ownerDepartmentId)
          .map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm text-ink">
              <Checkbox
                checked={value.secondary_department_ids.includes(d.id)}
                onCheckedChange={(checked) =>
                  set(
                    "secondary_department_ids",
                    checked === true
                      ? [...value.secondary_department_ids, d.id]
                      : value.secondary_department_ids.filter((x) => x !== d.id),
                  )
                }
              />
              {d.name}
              <span className="micro-label text-muted-foreground">{d.code}</span>
            </label>
          ))}
      </fieldset>
    </div>
  );
}
