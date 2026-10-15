"use client";

import { Bot, FileText, Star } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/rooms";
import { Avatar } from "./Avatar";

interface MessageThreadProps {
  messages: ChatMessage[];
  lastReadSeq: number;
  currentUserId: string;
  onOpenArtifact: (artifactId: string) => void;
  onCaseClick?: (caseCode: string) => void;
  /** Names that render as @mentions (Dejavu is always one). */
  mentionNames?: string[];
  currentUserName?: string;
}

const DAY = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tokenPattern(names: string[]): RegExp {
  const mentions = ["Dejavu", ...names]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  return new RegExp(
    `(#CASE-\\d{4}-\\d{3}\\b|\\[CASE-\\d{4}-\\d{3}\\]|@(?:${mentions})\\b)`,
    "g",
  );
}

function Content({
  text,
  pattern,
  me,
  onCaseClick,
}: {
  text: string;
  pattern: RegExp;
  me?: string;
  onCaseClick?: (code: string) => void;
}) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-ink">
      {text.split(pattern).map((part, index) => {
        if (index % 2 === 0) return part;
        if (part.startsWith("@")) {
          const isMe = part.slice(1) === me;
          return (
            <span
              key={index}
              className={cn(
                "px-0.5 font-medium text-navy",
                isMe ? "bg-modified-bg" : "bg-surface-3",
              )}
            >
              {part}
            </span>
          );
        }
        const code = part.replace(/^#|^\[|\]$/g, "");
        return (
          <button
            key={index}
            type="button"
            onClick={() => onCaseClick?.(code)}
            className="mx-0.5 border px-1 font-mono text-xs text-navy hover:bg-surface-2"
          >
            {part.startsWith("#") ? part : code}
          </button>
        );
      })}
    </p>
  );
}

/** The room's conversation, grouped by day, with a "New" divider at the first unread message. */
export function MessageThread({
  messages,
  lastReadSeq,
  currentUserId,
  onOpenArtifact,
  onCaseClick,
  mentionNames = [],
  currentUserName,
}: MessageThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const namesKey = mentionNames.join("|");
  const pattern = useMemo(
    () => tokenPattern(namesKey ? namesKey.split("|") : []),
    [namesKey],
  );
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  const firstUnread = messages.find(
    (m) => !m.pending && m.seq > lastReadSeq && m.author?.id !== currentUserId,
  )?.id;

  return (
    <ol className="flex flex-col gap-4 px-6 py-5">
      {messages.map((message, index) => {
        const day = DAY.format(new Date(message.created_at));
        const previous = messages[index - 1];
        const showDay =
          !previous || DAY.format(new Date(previous.created_at)) !== day;
        const mine = message.author?.id === currentUserId;
        const agent = Boolean(message.is_agent);
        return (
          <li key={message.id} className="flex flex-col gap-4">
            {showDay && (
              <div className="flex items-center gap-3" role="separator">
                <span className="h-px flex-1 bg-hairline" />
                <span className="micro-label text-muted-foreground">{day}</span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
            )}
            {message.id === firstUnread && (
              <div className="flex items-center gap-3" role="separator">
                <span className="h-px flex-1 bg-navy" />
                <span className="micro-label text-navy">New</span>
              </div>
            )}
            <article
              className={cn(
                "flex gap-3",
                mine && "flex-row-reverse",
                message.pending && "opacity-60",
              )}
              aria-label={mine ? "Your message" : undefined}
            >
              {agent ? (
                <span
                  className="flex size-7 shrink-0 items-center justify-center bg-navy text-white"
                  aria-hidden
                >
                  <Bot className="size-3.5" />
                </span>
              ) : (
                <Avatar
                  initials={message.author?.avatar_initials ?? "?"}
                  muted={!message.author?.is_active}
                />
              )}
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-1",
                  mine && "items-end",
                )}
              >
                <header
                  className={cn(
                    "flex items-baseline gap-2",
                    mine && "flex-row-reverse",
                  )}
                >
                  <span className="text-sm font-medium text-ink">
                    {mine
                      ? "You"
                      : agent
                        ? "Dejavu"
                        : (message.author?.name ?? "Former member")}
                  </span>
                  {agent && (
                    <span className="micro-label text-muted-foreground">
                      AI copilot
                    </span>
                  )}
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={message.created_at}
                  >
                    {message.pending
                      ? "Sending…"
                      : TIME.format(new Date(message.created_at))}
                  </time>
                  {message.is_milestone && (
                    <span className="micro-label flex items-center gap-1 text-navy">
                      <Star className="size-3" aria-hidden /> Milestone
                    </span>
                  )}
                </header>
                <div
                  className={cn(
                    mine &&
                      "max-w-[80%] border border-navy/20 bg-surface-2 px-3 py-2",
                    agent &&
                      "max-w-[85%] border-l-2 border-navy bg-surface-2 px-3 py-2",
                  )}
                >
                  <Content
                    text={message.content}
                    pattern={pattern}
                    me={currentUserName}
                    onCaseClick={onCaseClick}
                  />
                </div>
                {message.attached_artifact && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenArtifact(message.attached_artifact!.id)
                    }
                    className="flex w-fit max-w-full items-center gap-2 border px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate font-mono text-xs text-ink">
                      {message.attached_artifact.file_name}
                    </span>
                    <span className="micro-label text-muted-foreground">
                      {message.attached_artifact.file_type}
                    </span>
                  </button>
                )}
              </div>
            </article>
          </li>
        );
      })}
      <div ref={endRef} />
    </ol>
  );
}
