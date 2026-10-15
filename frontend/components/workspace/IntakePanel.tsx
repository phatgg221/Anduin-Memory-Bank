"use client";

import { Paperclip, UserPlus, X, Zap } from "lucide-react";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { SEVERITY_HELP } from "@/components/cases/SeverityBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/rooms/Avatar";
import type { DemoScenario } from "@/lib/demoScenarios";
import { cn } from "@/lib/utils";
import {
  SEVERITIES,
  SOURCE_TYPES,
  type CaseIntake,
  type RoomPerson,
  type Severity,
  type SourceType,
} from "@/types/rooms";

export interface IntakeSubmission {
  intake: Omit<CaseIntake, "lead_user_id">;
  files: File[];
  memberIds: string[];
  /** The scenario's home department, when a demo preset was loaded. */
  departmentId: string | null;
}

interface IntakePanelProps {
  scenarios: DemoScenario[];
  fundSuggestions: string[];
  people: RoomPerson[];
  currentUserId: string | null;
  departmentCodes: Record<string, string>;
  onRun: (submission: IntakeSubmission) => void;
  isRunning: boolean;
  runLabel?: string;
  error?: string;
}

const EMPTY: Omit<CaseIntake, "lead_user_id"> = {
  client_name: "",
  fund_name: null,
  source_type: null,
  title: "",
  initial_request_brief: "",
  severity: "MEDIUM",
  due_date: null,
  context_tags: {},
  secondary_department_ids: [],
};
const ACCEPT = ".pdf,.csv,.md,.txt,.json,.eml,.docx,.xlsx";

export function IntakePanel({
  scenarios,
  fundSuggestions,
  people,
  currentUserId,
  departmentCodes,
  onRun,
  isRunning,
  runLabel,
  error,
}: IntakePanelProps) {
  const [intake, setIntake] = useState(EMPTY);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [scenarioDepartment, setScenarioDepartment] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const me = people.find((p) => p.id === currentUserId);
  const selected = memberIds.map((id) => people.find((p) => p.id === id)).filter((p): p is RoomPerson => Boolean(p));
  const candidates = people.filter((p) => p.is_active && p.id !== currentUserId && !memberIds.includes(p.id));

  const set = <K extends keyof typeof intake>(key: K, value: (typeof intake)[K]) => setIntake((i) => ({ ...i, [key]: value }));
  const ready = intake.client_name.trim().length >= 2 && intake.initial_request_brief.trim().length >= 10;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list).filter((f) => !current.some((c) => c.name === f.name))]);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return setLocalError("Add the customer and at least a sentence describing the problem.");
    setLocalError(null);
    const source = SOURCE_TYPES.find((s) => s.id === intake.source_type)?.label;
    const title = intake.title.trim() || [intake.fund_name || intake.client_name, source].filter(Boolean).join(" — ");
    onRun({ intake: { ...intake, title: title.slice(0, 200) }, files, memberIds, departmentId: scenarioDepartment });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel index={1}>Incoming problem</SectionLabel>
        <DropdownMenu>
          <DropdownMenuTrigger className="micro-label flex items-center gap-1 border bg-background px-2 py-1 text-navy hover:bg-surface-3">
            <Zap className="size-3" aria-hidden /> Load demo
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="micro-label text-muted-foreground">Demo scenario</DropdownMenuLabel>
            {scenarios.map((scenario) => (
              <DropdownMenuItem
                key={scenario.id}
                onSelect={() => {
                  setIntake(scenario.intake);
                  setScenarioDepartment(scenario.departmentId);
                  setFiles([]);
                  setMemberIds(
                    people
                      .filter((p) => p.is_active && p.id !== currentUserId && scenario.people.includes(p.name))
                      .map((p) => p.id),
                  );
                }}
              >
                {scenario.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="intake-client" className="micro-label text-muted-foreground">Customer</Label>
          <Input id="intake-client" className="h-8 bg-background text-xs" value={intake.client_name} placeholder="Apollo Global" onChange={(e) => set("client_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="intake-fund" className="micro-label text-muted-foreground">Project / fund</Label>
          <Input
            id="intake-fund"
            list="intake-fund-options"
            className="h-8 bg-background text-xs"
            value={intake.fund_name ?? ""}
            placeholder="Crossover Feeder II"
            onChange={(e) => set("fund_name", e.target.value || null)}
          />
          <datalist id="intake-fund-options">
            {fundSuggestions.map((fund) => (
              <option key={fund} value={fund} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="micro-label text-muted-foreground">Incoming source</span>
        <div className="grid grid-cols-2 gap-1.5">
          {SOURCE_TYPES.map((source) => (
            <button
              key={source.id}
              type="button"
              aria-pressed={intake.source_type === source.id}
              onClick={() => set("source_type", intake.source_type === source.id ? null : (source.id as SourceType))}
              className={cn(
                "micro-label flex items-center gap-1.5 border px-2 py-1.5 text-left",
                intake.source_type === source.id ? "border-navy bg-navy text-white" : "bg-background text-muted-foreground hover:text-ink",
              )}
            >
              <span aria-hidden className={cn("size-1.5", intake.source_type === source.id ? "bg-white" : "bg-hairline")} />
              {source.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="intake-brief" className="micro-label text-muted-foreground">Problem / request details</Label>
        <Textarea
          id="intake-brief"
          rows={6}
          value={intake.initial_request_brief}
          onChange={(e) => set("initial_request_brief", e.target.value)}
          placeholder="Paste the client email, ticket or counsel request…"
          className="resize-y bg-background font-mono text-xs"
          maxLength={4000}
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("flex flex-col gap-1.5 border border-dashed p-2", dragging ? "border-navy bg-background" : "border-hairline")}
      >
        {files.map((file) => (
          <span key={file.name} className="flex items-center gap-1.5 border bg-background px-2 py-1 text-xs">
            <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-mono">{file.name}</span>
            <button type="button" className="ml-auto text-muted-foreground hover:text-ink" aria-label={`Remove ${file.name}`} onClick={() => setFiles((f) => f.filter((x) => x !== file))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button type="button" onClick={() => fileInput.current?.click()} className="text-left text-xs text-muted-foreground hover:text-ink">
          <Paperclip className="mr-1 inline size-3" aria-hidden />
          Drop the client&apos;s PDF / CSV here, or browse
        </button>
        <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="micro-label text-muted-foreground">Severity</span>
        <div className="grid grid-cols-4 gap-1">
          {SEVERITIES.map((severity: Severity) => (
            <button
              key={severity}
              type="button"
              title={SEVERITY_HELP[severity]}
              aria-pressed={intake.severity === severity}
              onClick={() => set("severity", severity)}
              className={cn(
                "micro-label border px-1 py-1 text-[10px]",
                intake.severity === severity ? "border-navy bg-background text-navy" : "text-muted-foreground hover:bg-background",
              )}
            >
              {severity}
            </button>
          ))}
        </div>
      </div>


      <div className="flex flex-col gap-1.5">
        <span className="micro-label text-muted-foreground">People to resolve it</span>
        <ul className="flex flex-col gap-1">
          {me && (
            <li className="flex items-center gap-2 border bg-background px-2 py-1 text-xs">
              <Avatar initials={me.avatar_initials} className="size-6" />
              <span className="flex-1 truncate text-ink">{me.name} (you)</span>
              <span className="micro-label text-muted-foreground">Owner</span>
            </li>
          )}
          {selected.map((person) => (
            <li key={person.id} className="flex items-center gap-2 border bg-background px-2 py-1 text-xs">
              <Avatar initials={person.avatar_initials} className="size-6" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ink">{person.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {person.job_title}
                  {person.primary_department_id && ` · ${departmentCodes[person.primary_department_id] ?? ""}`}
                </span>
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-ink"
                aria-label={`Remove ${person.name}`}
                onClick={() => setMemberIds((ids) => ids.filter((id) => id !== person.id))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-fit items-center gap-1.5 px-1 py-0.5 text-xs text-muted-foreground hover:text-ink">
              <UserPlus className="size-3.5" aria-hidden /> Add colleague
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="micro-label text-muted-foreground">Engage to resolve</DropdownMenuLabel>
              {candidates.map((person) => (
                <DropdownMenuItem key={person.id} onSelect={() => setMemberIds((ids) => [...ids, person.id])} className="gap-2">
                  <Avatar initials={person.avatar_initials} className="size-6" />
                  <span className="flex-1">{person.name}</span>
                  {person.primary_department_id && (
                    <span className="micro-label text-muted-foreground">{departmentCodes[person.primary_department_id]}</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {(localError ?? error) && (
        <p role="alert" className="border border-destructive bg-background px-2 py-1.5 text-xs text-destructive">
          {localError ?? error}
        </p>
      )}

      <ActionButton type="submit" className={cn("w-full", !ready && "opacity-60")} disabled={isRunning}>
        {isRunning ? (runLabel ?? "Opening room…") : "Run Dejavu analysis & open room"}
      </ActionButton>
    </form>
  );
}
