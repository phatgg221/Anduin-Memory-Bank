"use client";

import { Star } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ComposerProps {
  roomName: string;
  onSend: (content: string, isMilestone: boolean) => void;
  error?: string;
}

/** Message box: Enter sends, Shift+Enter adds a line. Tag a case with #CASE-2026-047. */
export function Composer({ roomName, onSend, error }: ComposerProps) {
  const [text, setText] = useState("");
  const [milestone, setMilestone] = useState(false);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const content = text.trim();
    if (!content) return;
    onSend(content, milestone);
    setText("");
    setMilestone(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t bg-background px-6 py-4">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Message #${roomName} · tag a case with #CASE-2026-047`}
        rows={2}
        maxLength={4000}
        className="min-h-16 resize-none"
        aria-label={`Message ${roomName}`}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setMilestone((value) => !value)}
          aria-pressed={milestone}
          className={cn(
            "micro-label flex items-center gap-1.5 border px-2 py-1",
            milestone ? "border-navy text-navy" : "text-muted-foreground hover:bg-surface-2",
          )}
        >
          <Star className="size-3" aria-hidden /> Milestone
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
        <ActionButton type="submit" className="ml-auto w-36" disabled={!text.trim()}>
          Send
        </ActionButton>
      </div>
    </form>
  );
}
