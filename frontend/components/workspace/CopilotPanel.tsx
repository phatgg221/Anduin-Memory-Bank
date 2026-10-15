"use client";

import { Bot, LoaderCircle, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CaseJob, CopilotMessage } from "@/types/memory";

interface CopilotPanelProps {
  messages: CopilotMessage[];
  jobs: CaseJob[];
  chips: string[];
  onAsk: (question: string) => void;
  onCaseClick: (caseCode: string) => void;
  error?: string;
  hideTitle?: boolean;
}

const CITATION = /(\[CASE-\d{4}-\d{3}\])/g;

function Answer({ text, onCaseClick }: { text: string; onCaseClick: (code: string) => void }) {
  return (
    <p className="whitespace-pre-wrap text-sm text-ink">
      {text.split(CITATION).map((part, i) =>
        i % 2 === 1 ? (
          <button key={i} type="button" onClick={() => onCaseClick(part.slice(1, -1))} className="mx-0.5 border px-1 font-mono text-[11px] text-navy hover:bg-surface-2">
            {part.slice(1, -1)}
          </button>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** `■ 03B / DEJAVU AI MEMORY COPILOT` — grounded Q&A over this case and the Memory Bank. */
export function CopilotPanel({ messages, jobs, chips, onAsk, onCaseClick, error, hideTitle }: CopilotPanelProps) {
  const [question, setQuestion] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const thinking = jobs.find((j) => j.status === "QUEUED" || j.status === "PROCESSING");
  const failed = jobs.filter((j) => j.status === "FAILED");

  // Scroll only the conversation itself, never the surrounding pane.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, thinking?.step]);

  const ask = (text: string, event?: FormEvent) => {
    event?.preventDefault();
    const q = text.trim();
    if (q.length < 2) return;
    onAsk(q);
    setQuestion("");
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      {!hideTitle && <SectionLabel>Dejavu memory copilot</SectionLabel>}
      <div ref={listRef} className="flex min-h-32 flex-1 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && !thinking && (
          <p className="text-xs text-muted-foreground">
            Ask about this case: answers come only from the case, its matched precedents and the Memory Bank, with
            citations.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={cn("flex flex-col gap-1", message.role === "user" && "items-end")}>
            {message.role === "assistant" ? (
              <div className="flex flex-col gap-1 border bg-background p-2.5">
                <span className="micro-label flex items-center gap-1 text-navy">
                  <Bot className="size-3" aria-hidden /> Dejavu copilot
                </span>
                <Answer text={message.content} onCaseClick={onCaseClick} />
              </div>
            ) : (
              <p className={cn("max-w-[90%] border border-navy/20 bg-surface-3 px-2.5 py-1.5 text-sm text-ink", message.pending && "opacity-60")}>
                {message.content}
              </p>
            )}
          </div>
        ))}
        {thinking && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> {thinking.step ?? "Queued"}…
          </p>
        )}
        {failed.map((job) => (
          <p key={job.id} className="text-xs text-destructive">
            Couldn&apos;t answer: {job.error}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button key={chip} type="button" onClick={() => ask(chip)} className="border bg-background px-2 py-1 text-left text-xs text-ink hover:bg-surface-3">
            {chip}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <form onSubmit={(e) => ask(question, e)} className="flex items-end gap-1.5">
        <Textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) ask(question, e);
          }}
          placeholder="Ask Dejavu copilot…"
          className="min-h-14 resize-none bg-background text-sm"
          aria-label="Ask the copilot"
          maxLength={2000}
        />
        <Button type="submit" size="icon" aria-label="Ask" disabled={question.trim().length < 2}>
          <SendHorizontal className="size-4" />
        </Button>
      </form>
    </section>
  );
}
