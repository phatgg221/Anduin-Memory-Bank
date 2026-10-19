"use client";

import { useState, type ReactNode } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { StatusBadge } from "@/components/brand/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Step {
  label: string;
  title: string;
  body: string;
  points: ReactNode[];
}

const STEPS: Step[] = [
  {
    label: "Welcome",
    title: "Stop solving the same problem twice.",
    body: "Dejavu is a case triage workbench. When a new request comes in, it finds the past cases that look like it and shows you what to reuse.",
    points: [
      "Every resolved case becomes team memory, including what departed colleagues knew.",
      "Everything Dejavu says links back to a case, a file or a page.",
      "Use the department switcher in the header to filter by team.",
    ],
  },
  {
    label: "Open a case",
    title: "Start from the Workbench.",
    body: "Log a new request with the intake form: customer, problem and context, severity, deadline, owner and tags. Attach the files you have.",
    points: [
      "The triage agent searches the vault, checks for duplicates and finds who has handled this before.",
      "You watch each step live, then get a report: summary, risk and effort, missing info, suggested team.",
      "Department rooms and active case rooms are on the same page.",
    ],
  },
  {
    label: "Precedent & delta",
    title: "See how similar cases went.",
    body: "The Precedent & delta tab ranks the top 3 past cases by match, with their outcomes, then sorts the work into three groups:",
    points: [
      <span key="reusable" className="flex items-center gap-2">
        <StatusBadge status="REUSABLE" /> use as is
      </span>,
      <span key="modified" className="flex items-center gap-2">
        <StatusBadge status="MODIFIED" /> adapt for this case
      </span>,
      <span key="net-new" className="flex items-center gap-2">
        <StatusBadge status="NET_NEW" /> nobody has done this before
      </span>,
    ],
  },
  {
    label: "Reuse & discuss",
    title: "Reuse past work and ask the memory.",
    body: "The reusable kit on the right lists files from matching cases. Click Use in case and Dejavu explains why the file fits and what to change, with page citations.",
    points: [
      "Type @Dejavu in the case channel, or use the Memory copilot tab, for answers backed by past cases.",
      "Select a few messages to have Dejavu check a proposed solution against memory.",
      "Case chats are open to members only. If you're not a member, click Ask to join.",
    ],
  },
  {
    label: "Save to memory",
    title: "Close the loop.",
    body: "When the work is done, click Complete & save to memory. Add the outcome and the deliverables, and Dejavu drafts the memory entry.",
    points: [
      "Review the summary, choose which files are reusable, and check any conflicts with older cases it flags.",
      "When you commit, the case is indexed and will be matched against the next similar request.",
      "Browse every resolved case and file in the Knowledge Vault.",
    ],
  },
];

interface OnboardingGuideProps {
  open: boolean;
  userName: string;
  onDismiss: () => void;
}

export function OnboardingGuide({ open, userName, onDismiss }: OnboardingGuideProps) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const close = () => {
    onDismiss();
    setIndex(0);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl" showCloseButton={false}>
        <div className="flex items-center justify-between bg-navy px-6 py-3">
          <SectionLabel as="p" inverse>
            Dejavu guide
          </SectionLabel>
          <span className="micro-label text-white">
            {String(index + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </span>
        </div>

        <ol className="grid grid-cols-5 divide-x border-b" aria-label="Guide steps">
          {STEPS.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? "step" : undefined}
                className={cn(
                  "micro-label w-full truncate border-b-2 px-2 py-2.5 text-left",
                  i === index
                    ? "border-navy bg-background text-navy"
                    : "border-transparent bg-surface-2 text-muted-foreground hover:bg-surface-3",
                )}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="flex min-h-80 flex-col gap-5 p-6">
          <SectionLabel as="p" index={index + 1}>
            {step.label}
          </SectionLabel>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-xl font-semibold text-ink">
              {index === 0 ? `Welcome, ${userName.split(" ")[0]}. ` : ""}
              {step.title}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{step.body}</DialogDescription>
          </div>
          <ul className="flex flex-col divide-y border">
            {step.points.map((point, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3 text-sm text-ink">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 bg-navy" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t bg-surface-2 px-6 py-3">
          <Button variant="ghost" onClick={close}>
            Skip guide
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="outline" onClick={() => setIndex(index - 1)}>
                Back
              </Button>
            )}
            <ActionButton onClick={() => (last ? close() : setIndex(index + 1))}>
              {last ? "Start working" : "Next"}
            </ActionButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
