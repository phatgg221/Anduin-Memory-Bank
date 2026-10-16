"use client";

import {
  BarChart3,
  Bot,
  Check,
  Copy,
  Database,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CaseJob, TraceEvent } from "@/types/memory";

const ICONS: Record<string, LucideIcon> = {
  index: Database,
  rank: BarChart3,
  search_knowledge_vault: Search,
  check_active_duplicates: Copy,
  get_case_details: FolderOpen,
  find_people: Users,
  estimate_effort: Timer,
  guard: ShieldCheck,
  fallback: TriangleAlert,
};

const plane = (cy: number) => `M120 ${cy - 46} L200 ${cy} L120 ${cy + 46} L40 ${cy} Z`;

function ScanningStack({ active }: { active: number }) {
  return (
    <div className="relative mx-auto w-52 overflow-hidden" aria-hidden>
      <svg viewBox="0 0 240 210" fill="none" className="h-auto w-full">
        <path d="M40 64 V150 M200 64 V150 M120 110 V196" className="stroke-surface-3" strokeDasharray="3 4" />
        {[150, 107, 64].map((cy, index) => (
          <path
            key={cy}
            d={plane(cy)}
            className={cn(
              "transition-colors duration-700",
              index === 2 ? "fill-white stroke-navy" : "fill-white stroke-surface-3",
              active === index && "animate-pulse fill-surface-2 stroke-navy",
            )}
            strokeWidth={index === 2 || active === index ? 1.5 : 1}
          />
        ))}
        <ellipse cx="120" cy="64" rx="38" ry="21" className="animate-pulse stroke-brand-cyan" strokeWidth={1.5} />
        <rect x="116" y="60" width="8" height="8" className="fill-navy" />
      </svg>
      <div className="animate-dejavu-scan absolute inset-x-4 top-0 h-px bg-brand-cyan" />
    </div>
  );
}

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function FeedRow({ event, startedAt, latest }: { event: TraceEvent; startedAt: number; latest: boolean }) {
  const Icon = ICONS[event.tool] ?? Bot;
  const offset = (new Date(event.at).getTime() - startedAt) / 1000;
  return (
    <li
      className={cn(
        "flex animate-in items-start gap-3 border-b px-4 py-3 duration-500 fade-in slide-in-from-bottom-1",
        latest && "bg-surface-2",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center",
          event.tool === "fallback" ? "bg-modified-bg text-modified" : "bg-navy text-white",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm text-ink">
          {event.label}
          {event.auto && <span className="micro-label text-muted-foreground">auto-check</span>}
        </span>
        <span className="break-words font-mono text-xs text-muted-foreground">{event.detail}</span>
      </span>
      <span className="micro-label shrink-0 text-muted-foreground">+{offset.toFixed(1)}s</span>
    </li>
  );
}

interface InvestigationScreenProps {
  job: CaseJob;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function InvestigationScreen({ job, onRetry, isRetrying }: InvestigationScreenProps) {
  const [now, setNow] = useState(() => Date.now());
  const running = job.status === "QUEUED" || job.status === "PROCESSING";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [running]);

  const startedAt = new Date(job.created_at).getTime();
  const trace = job.trace ?? [];
  const current = job.step ? job.steps.indexOf(job.step) : -1;
  const toolCalls = trace.filter((e) => !["index", "rank", "guard", "fallback"].includes(e.tool)).length;
  const casesOpened = trace.filter((e) => e.tool === "get_case_details").length;
  const failed = job.status === "FAILED";

  return (
    <div className="flex flex-col gap-0 p-6" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3 bg-navy px-5 py-3 text-white">
        <Bot className="size-4" aria-hidden />
        <span className="micro-label flex-1">
          {failed ? "Investigation stopped" : job.status === "QUEUED" ? "Dejavu agent · queued" : "Dejavu agent · investigating"}
        </span>
        <span className="micro-label tabular-nums">{elapsedLabel((running ? now : new Date(job.updated_at).getTime()) - startedAt)}</span>
      </div>

      <div className="grid grid-cols-1 border border-t-0 @3xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5 border-b p-5 @3xl:border-r @3xl:border-b-0">
          <ScanningStack active={Math.max(0, 2 - Math.max(current, 0))} />
          <ol className="flex flex-col gap-2">
            {job.steps.map((step, index) => {
              const state = index < current || job.status === "COMPLETED" ? "done" : index === current && running ? "active" : "todo";
              return (
                <li
                  key={step}
                  className={cn("flex items-center gap-2 text-sm", state === "todo" ? "text-muted-foreground" : "text-ink")}
                >
                  {state === "done" ? (
                    <Check className="size-4 text-reusable" aria-hidden />
                  ) : state === "active" ? (
                    <LoaderCircle className="size-4 animate-spin text-navy" aria-hidden />
                  ) : (
                    <span className="flex size-4 items-center justify-center">
                      <span className="size-1.5 bg-hairline" />
                    </span>
                  )}
                  {step}
                </li>
              );
            })}
          </ol>
          <dl className="grid grid-cols-2 gap-px bg-hairline text-center">
            <div className="flex flex-col gap-0.5 bg-background p-2">
              <dt className="micro-label text-muted-foreground">Tool calls</dt>
              <dd className="text-lg font-medium tabular-nums text-ink">{toolCalls}</dd>
            </div>
            <div className="flex flex-col gap-0.5 bg-background p-2">
              <dt className="micro-label text-muted-foreground">Cases opened</dt>
              <dd className="text-lg font-medium tabular-nums text-ink">{casesOpened}</dd>
            </div>
          </dl>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="micro-label text-navy">Live investigation</span>
            <span className="micro-label text-muted-foreground">Scores & IDs are set by code, not the model</span>
          </div>
          <ol className="flex flex-col">
            {trace.map((event, index) => (
              <FeedRow key={event.id} event={event} startedAt={startedAt} latest={running && index === trace.length - 1} />
            ))}
            {running && (
              <li className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
                <span className="flex size-7 items-center justify-center border border-dashed">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                </span>
                {job.status === "QUEUED"
                  ? "Waiting for a worker…"
                  : trace.length === 0
                    ? "Reading the request and its files…"
                    : current >= 2
                      ? "Writing the triage report and delta matrix…"
                      : "Deciding what to look at next…"}
              </li>
            )}
          </ol>
          {failed && (
            <div className="flex flex-col items-start gap-3 p-4">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {job.error ?? "The investigation failed."}
              </p>
              {onRetry && (
                <Button onClick={onRetry} disabled={isRetrying} className="gap-1.5">
                  <RotateCcw className="size-3.5" aria-hidden /> Run the investigation again
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
