"use client";

import { CalendarClock, FileText, Pencil, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Department } from "@/types/org";
import { SOURCE_TYPES, type CaseIntake, type RoomPerson, type ThreadView, type UpdateCaseInput } from "@/types/rooms";
import { CaseIntakeFields } from "./CaseIntakeFields";
import { deadlineLabel, SeverityBadge } from "./SeverityBadge";

interface CaseDetailsPanelProps {
  thread: ThreadView;
  departments: Department[];
  people: RoomPerson[];
  onSave: (input: UpdateCaseInput) => void;
  isSaving: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  onOpenFile: (fileId: string) => void;
}

const DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 text-sm">
      <dt className="micro-label pt-0.5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function toIntake(thread: ThreadView): CaseIntake {
  return {
    client_name: thread.client_name ?? "",
    fund_name: thread.fund_name,
    source_type: thread.source_type,
    title: thread.title,
    initial_request_brief: thread.initial_request_brief,
    severity: thread.severity,
    due_date: thread.due_date,
    lead_user_id: thread.lead?.id ?? null,
    context_tags: thread.context_tags,
    secondary_department_ids: thread.secondary_department_ids,
  };
}

/** `■ CASE DETAILS` — everything about the case behind a thread. Editable while the case is open. */
export function CaseDetailsPanel({ thread, departments, people, onSave, isSaving, error, fieldErrors, onOpenFile }: CaseDetailsPanelProps) {
  const [editing, setEditing] = useState<CaseIntake | null>(null);
  const open = thread.status === "OPEN";
  const names = Object.fromEntries(departments.map((d) => [d.id, d]));
  const deadline = deadlineLabel(thread.due_date);

  if (editing) {
    return (
      <form
        className="flex flex-col gap-5 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (editing.client_name.trim().length < 2 || editing.title.trim().length < 3 || editing.initial_request_brief.trim().length < 10) return;
          onSave(editing);
          setEditing(null);
        }}
      >
        <SectionLabel>Edit case details</SectionLabel>
        <CaseIntakeFields
          idPrefix={`edit-${thread.id}`}
          value={editing}
          onChange={setEditing}
          people={people}
          departments={departments}
          ownerDepartmentId={thread.department_id}
          fieldErrors={fieldErrors}
        />
        <div className="flex gap-2 border-t pt-4">
          <Button type="submit" disabled={isSaving}>
            Save details
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Case details</SectionLabel>
        {open && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(toIntake(thread))}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="border border-destructive px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro-label text-navy">{thread.case_code}</span>
          <SeverityBadge severity={thread.severity} />
          <span className={cn("micro-label border px-1.5 py-0.5", open ? "text-ink" : "border-reusable-border bg-reusable-bg text-reusable")}>
            {open ? "Open" : "In memory"}
          </span>
        </div>
        <h3 className="text-base font-medium text-ink">{thread.title}</h3>
      </div>

      <dl className="flex flex-col gap-2.5">
        <Row label="Customer">{thread.client_name ?? <span className="text-muted-foreground">Not recorded</span>}</Row>
        <Row label="Project">{thread.fund_name ?? <span className="text-muted-foreground">Not recorded</span>}</Row>
        <Row label="Source">
          {SOURCE_TYPES.find((s) => s.id === thread.source_type)?.label ?? <span className="text-muted-foreground">Not recorded</span>}
        </Row>
        <Row label="Deadline">
          {thread.due_date ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
              {DATE.format(new Date(`${thread.due_date}T00:00:00`))}
              {open && deadline && (
                <span className={cn("text-xs", deadline.overdue ? "text-destructive" : "text-muted-foreground")}>· {deadline.text}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">None set</span>
          )}
        </Row>
        <Row label="Owner">
          {thread.lead ? (
            <span className="flex items-center gap-1.5">
              <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
              {thread.lead.name}
              {!thread.lead.is_active && <span className="micro-label text-alumni">Alumni</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </Row>
        <Row label="Departments">
          <span className="flex flex-wrap gap-1">
            {[thread.department_id, ...thread.secondary_department_ids].map((id, index) => (
              <span
                key={id}
                title={names[id]?.name}
                className={cn("micro-label px-1.5 py-0.5", index === 0 ? "bg-navy text-white" : "border text-muted-foreground")}
              >
                {names[id]?.code ?? id}
              </span>
            ))}
          </span>
        </Row>
        <Row label="Opened">
          {DATE.format(new Date(thread.created_at))}
          {thread.created_by && <span className="text-muted-foreground"> by {thread.created_by.name}</span>}
        </Row>
        <Row label="Activity">
          {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"} · {thread.participants.length} participant
          {thread.participants.length === 1 ? "" : "s"}
        </Row>
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="micro-label text-muted-foreground">Problem &amp; context</span>
        <p className="whitespace-pre-wrap text-sm text-ink">{thread.initial_request_brief}</p>
      </div>

      {Object.keys(thread.context_tags).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="micro-label text-muted-foreground">Context tags</span>
          <dl className="flex flex-wrap gap-1.5">
            {Object.entries(thread.context_tags).map(([label, value]) => (
              <div key={label} className="flex border text-xs">
                <dt className="bg-surface-2 px-1.5 py-0.5 text-muted-foreground">{label}</dt>
                <dd className="px-1.5 py-0.5 text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="micro-label text-muted-foreground">Files · {thread.artifacts.length}</span>
        {thread.artifacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No files on this case yet.</p>
        ) : (
          <ul className="flex flex-col divide-y border">
            {thread.artifacts.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onOpenFile(file.id)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2"
                  title={file.description}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-mono text-xs text-ink">{file.file_name}</span>
                  <span className="micro-label ml-auto shrink-0 text-muted-foreground">{file.file_type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!open && thread.summary && (
        <div className="flex flex-col gap-1.5 border-t pt-4">
          <span className="micro-label text-reusable">Committed memory</span>
          <p className="text-sm text-ink">{thread.summary}</p>
        </div>
      )}
    </section>
  );
}
