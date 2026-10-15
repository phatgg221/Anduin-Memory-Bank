"use client";

import { useState, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { CaseIntakeFields } from "@/components/cases/CaseIntakeFields";
import { Button } from "@/components/ui/button";
import type { Department } from "@/types/org";
import type { CaseIntake, RoomPerson } from "@/types/rooms";

interface NewThreadFormProps {
  department: Department;
  departments: Department[];
  people: RoomPerson[];
  currentUserId: string;
  onSubmit: (values: CaseIntake) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Case intake: opens a case with its own sub-chat under this room and every department it involves. */
export function NewThreadForm({
  department,
  departments,
  people,
  currentUserId,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
  fieldErrors = {},
}: NewThreadFormProps) {
  const [value, setValue] = useState<CaseIntake>({
    client_name: "",
    title: "",
    initial_request_brief: "",
    severity: "MEDIUM",
    due_date: null,
    lead_user_id: currentUserId,
    context_tags: {},
    secondary_department_ids: [],
  });
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (value.client_name.trim().length < 2) errors.client_name = "Who is this for? Enter the customer.";
    if (value.title.trim().length < 3) errors.title = "Give the case a title of at least 3 characters.";
    if (value.initial_request_brief.trim().length < 10) {
      errors.initial_request_brief = "Describe the problem in at least 10 characters.";
    }
    setLocalErrors(errors);
    if (Object.keys(errors).length) return;
    onSubmit({
      ...value,
      client_name: value.client_name.trim(),
      title: value.title.trim(),
      initial_request_brief: value.initial_request_brief.trim(),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-2">
        <SectionLabel>New case thread · {department.code}</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Opens a case with its own sub-chat, listed under {department.name} and every department you involve. The
          intake below gives the team (and the AI summarizer later) the full context from the first message.
        </p>
      </div>

      <CaseIntakeFields
        idPrefix="new-case"
        value={value}
        onChange={setValue}
        people={people}
        departments={departments}
        ownerDepartmentId={department.id}
        fieldErrors={{ ...fieldErrors, ...localErrors }}
      />

      {error && (
        <p role="alert" className="border border-destructive px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t pt-4">
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
