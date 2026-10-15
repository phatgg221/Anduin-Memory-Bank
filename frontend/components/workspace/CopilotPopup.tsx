"use client";

import { Bot, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { CopilotPanel } from "./CopilotPanel";

type CopilotPopupProps = ComponentProps<typeof CopilotPanel> & { caseCode: string };

export function CopilotPopup({ caseCode, ...panel }: CopilotPopupProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const answers = panel.messages.filter((m) => m.role === "assistant").length;
  const [seenAnswers, setSeenAnswers] = useState(answers);
  const thinking = panel.jobs.some((j) => j.status === "QUEUED" || j.status === "PROCESSING");
  const unread = !open && answers > seenAnswers;
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    setOpen(true);
    setSeenAnswers(answers);
  };
  const hide = () => {
    setOpen(false);
    setSeenAnswers(answers);
  };

  if (!open) {
    return (
      <button
        ref={launcher}
        type="button"
        onClick={show}
        aria-label={unread ? "Open Dejavu copilot (new answer)" : "Open Dejavu copilot"}
        className="fixed right-6 bottom-12 z-40 flex items-center gap-2 border border-navy bg-navy px-4 py-3 text-sm font-medium text-white hover:bg-ink"
      >
        <Bot className="size-4" aria-hidden />
        Ask Dejavu
        {(unread || thinking) && (
          <span
            aria-hidden
            className={cn("size-2", unread ? "bg-brand-cyan" : "animate-pulse bg-white/70")}
          />
        )}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Dejavu memory copilot"
      className={cn(
        "fixed right-6 bottom-12 z-40 flex flex-col border border-navy bg-surface-2",
        expanded ? "h-[min(85dvh,880px)] w-[min(760px,calc(100vw-3rem))]" : "h-[min(70dvh,640px)] w-[min(420px,calc(100vw-3rem))]",
      )}
    >
      <div className="flex items-center gap-2 border-b bg-navy px-3 py-2 text-white">
        <Bot className="size-4" aria-hidden />
        <span className="micro-label flex-1 truncate">Dejavu copilot · {caseCode}</span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Make copilot smaller" : "Make copilot larger"}
          className="p-1 hover:bg-white/10"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button type="button" onClick={hide} aria-label="Close copilot" className="p-1 hover:bg-white/10">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <CopilotPanel {...panel} hideTitle />
      </div>
    </div>
  );
}
