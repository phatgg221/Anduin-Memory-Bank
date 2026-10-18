"use client";

import { Bot, Star } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";

export interface Mentionable {
  id: string;
  name: string;
  initials: string;
  hint?: string;
  agent?: boolean;
}

interface ComposerProps {
  roomName: string;
  onSend: (content: string, isMilestone: boolean, mentionedIds: string[]) => void;
  onTyping?: () => void;
  /** Names of other people typing right now. */
  typingNames?: string[];
  error?: string;
  /** Who `@` can mention, in order. */
  mentionables?: Mentionable[];
}

const MENTION_QUERY = /(?:^|\s)@([\p{L}.'-]*(?: [\p{L}.'-]*)?)$/u;

function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

/** Message box: Enter sends, Shift+Enter adds a line, `@` mentions, #CASE-2026-047 tags a case. */
export function Composer({ roomName, onSend, onTyping, typingNames = [], error, mentionables = [] }: ComposerProps) {
  const [text, setText] = useState("");
  const [milestone, setMilestone] = useState(false);
  const [query, setQuery] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  const matches = query
    ? mentionables.filter((m) => m.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 8)
    : [];
  const open = matches.length > 0;

  const detect = (value: string, caret: number) => {
    const found = mentionables.length ? MENTION_QUERY.exec(value.slice(0, caret)) : null;
    setQuery(found ? { text: found[1], start: caret - found[1].length - 1, end: caret } : null);
    setActive(0);
  };

  const pick = (mention: Mentionable) => {
    if (!query) return;
    const insert = `@${mention.name} `;
    const next = text.slice(0, query.start) + insert + text.slice(query.end);
    setText(next);
    setQuery(null);
    const position = query.start + insert.length;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(position, position);
    });
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const content = text.trim();
    if (!content) return;
    const mentioned = mentionables.filter((m) => !m.agent && content.includes(`@${m.name}`)).map((m) => m.id);
    onSend(content, milestone, mentioned);
    setText("");
    setMilestone(false);
    setQuery(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
        event.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t bg-background px-6 py-4">
      <p className="h-4 text-xs text-muted-foreground" aria-live="polite">
        {typingNames.length > 0 && typingLabel(typingNames)}
      </p>
      <div className="relative">
        {open && (
          <ul
            role="listbox"
            aria-label="Mention"
            className="absolute bottom-full left-0 z-20 mb-1 flex w-80 flex-col border bg-background py-1"
          >
            {matches.map((mention, index) => (
              <li
                key={mention.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(mention);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn("flex cursor-pointer items-center gap-2 px-2 py-1.5", index === active && "bg-surface-2")}
              >
                {mention.agent ? (
                  <span className="flex size-6 shrink-0 items-center justify-center bg-navy text-white">
                    <Bot className="size-3.5" aria-hidden />
                  </span>
                ) : (
                  <Avatar initials={mention.initials} className="size-6" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink">{mention.name}</span>
                  {mention.hint && <span className="truncate text-[11px] text-muted-foreground">{mention.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={box}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            detect(event.target.value, event.target.selectionStart);
            if (event.target.value) onTyping?.();
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setQuery(null)}
          placeholder={
            mentionables.length
              ? `Message #${roomName} · @ to mention a colleague or Dejavu`
              : `Message #${roomName} · tag a case with #CASE-2026-047`
          }
          rows={2}
          maxLength={4000}
          className="min-h-16 resize-none"
          aria-label={`Message ${roomName}`}
          aria-expanded={open}
        />
      </div>
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
