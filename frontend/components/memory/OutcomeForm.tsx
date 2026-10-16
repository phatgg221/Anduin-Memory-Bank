"use client";

import { BadgeCheck, Bot, Check, FileText, Paperclip, X } from "lucide-react";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CASE_OUTCOMES, type CaseOutcome, type OutcomeInput } from "@/types/memory";
import type { CaseFile } from "@/types/rooms";

export type OutcomeUploadKind = "CLIENT_APPROVAL" | "FINAL_OUTPUT";

export interface OutcomeUpload {
  file: File;
  kind: OutcomeUploadKind;
}

interface OutcomeFormProps {
  clientName: string | null;
  files: CaseFile[];
  initial?: Partial<OutcomeInput>;
  onSubmit: (input: OutcomeInput, uploads: OutcomeUpload[]) => void;
  isSubmitting: boolean;
  submitLabel?: string;
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.eml,.docx,.xlsx,.csv,.md,.txt,.json";
const KINDS: { id: OutcomeUploadKind; label: string }[] = [
  { id: "CLIENT_APPROVAL", label: "Client approval" },
  { id: "FINAL_OUTPUT", label: "Final output" },
];

function guessKind(name: string): OutcomeUploadKind {
  return /approv|sign[-_ ]?off|confirm|accept|\.eml$/i.test(name) ? "CLIENT_APPROVAL" : "FINAL_OUTPUT";
}

export function OutcomeForm({ clientName, files, initial, onSubmit, isSubmitting, submitLabel }: OutcomeFormProps) {
  const [outcome, setOutcome] = useState<CaseOutcome | null>(initial?.outcome ?? null);
  const [finalOutput, setFinalOutput] = useState(initial?.final_output ?? "");
  const [deliverables, setDeliverables] = useState<string[]>(initial?.deliverable_file_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<OutcomeUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setUploads((current) => [
      ...current,
      ...Array.from(list)
        .filter((f) => !current.some((u) => u.file.name === f.name))
        .map((file) => ({ file, kind: guessKind(file.name) })),
    ]);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const toggle = (id: string) =>
    setDeliverables((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!outcome) return setError("Choose how the case ended.");
    const text = finalOutput.trim();
    if (text.length < 10 && uploads.length === 0)
      return setError("Describe the final output, or attach the client's approval or the delivered file.");
    setError(null);
    const attached = uploads.map((u) => u.file.name).join(", ");
    onSubmit(
      {
        outcome,
        final_output: text.length >= 10 ? text : `Final output and client approval in the attached file(s): ${attached}`,
        deliverable_file_ids: deliverables,
      },
      uploads,
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex items-start gap-3 border-l-2 border-navy bg-surface-2 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center bg-navy text-white">
          <Bot className="size-3.5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-navy">Dejavu · Memory curator</span>
          <p className="text-sm text-ink">
            Before I write the memory record from the case chat: how did this case end, and what did{" "}
            {clientName ?? "the client"} finally get? I&apos;ll use your answer as the ending of the story, suggest
            which files to keep as reusable knowledge, and check the lessons against older cases.
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="micro-label mb-2 text-muted-foreground">Outcome</legend>
        <div className="grid grid-cols-1 gap-1.5 @xl:grid-cols-5">
          {CASE_OUTCOMES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={outcome === option.id}
              onClick={() => setOutcome(option.id)}
              className={cn(
                "flex flex-col items-start gap-1 border px-3 py-2 text-left",
                outcome === option.id ? "border-navy bg-navy text-white" : "hover:bg-surface-2",
              )}
            >
              <span className="micro-label">{option.label}</span>
              <span className={cn("text-xs", outcome === option.id ? "text-white/80" : "text-muted-foreground")}>
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="final-output" className="micro-label text-muted-foreground">
          Final output — what was delivered or agreed
        </Label>
        <Textarea
          id="final-output"
          rows={4}
          value={finalOutput}
          onChange={(e) => setFinalOutput(e.target.value)}
          placeholder="e.g. Shipped the Designated Tax Signatory schema to both signers; MFN bracket at $15M agreed in the side letter; custody annex deferred to the second close."
          maxLength={2000}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="micro-label text-muted-foreground">Client approval or final output files</span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col gap-2 border border-dashed p-3",
            dragging ? "border-navy bg-surface-2" : "border-hairline",
          )}
        >
          {uploads.map((upload) => (
            <div key={upload.file.name} className="flex flex-wrap items-center gap-2 border bg-background px-2 py-1.5">
              {upload.kind === "CLIENT_APPROVAL" ? (
                <BadgeCheck className="size-3.5 shrink-0 text-reusable" aria-hidden />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{upload.file.name}</span>
              <div className="flex" role="radiogroup" aria-label={`What is ${upload.file.name}?`}>
                {KINDS.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    role="radio"
                    aria-checked={upload.kind === kind.id}
                    onClick={() =>
                      setUploads((all) => all.map((u) => (u === upload ? { ...u, kind: kind.id } : u)))
                    }
                    className={cn(
                      "micro-label border px-1.5 py-0.5 text-[10px]",
                      upload.kind === kind.id ? "border-navy bg-navy text-white" : "text-muted-foreground",
                    )}
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remove ${upload.file.name}`}
                className="text-muted-foreground hover:text-ink"
                onClick={() => setUploads((all) => all.filter((u) => u !== upload))}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-ink"
          >
            <Paperclip className="size-3.5" aria-hidden />
            Drop the client&apos;s approval email, signed PDF or a photo of it, or the delivered file — or browse. Scans
            are read by OCR. Dejavu reads it
            for the memory record.
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {files.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="micro-label mb-2 text-muted-foreground">Already on the case — which were final deliverables?</legend>
          <ul className="flex flex-col divide-y border">
            {files.map((file) => {
              const checked = deliverables.includes(file.id);
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggle(file.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center border",
                        checked ? "border-navy bg-navy text-white" : "bg-background",
                      )}
                    >
                      {checked && <Check className="size-3" aria-hidden />}
                    </span>
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-mono text-xs text-ink">{file.file_name}</span>
                    <span className="micro-label ml-auto shrink-0 text-muted-foreground">
                      {file.text_status === "PENDING" ? "Reading…" : file.file_type}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="border border-destructive px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <ActionButton type="submit" className="w-72" disabled={isSubmitting}>
        {isSubmitting ? (submitLabel ?? "Starting the curator…") : "Draft memory record"}
      </ActionButton>
    </form>
  );
}
