"use client";

import {
  Bot,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Copy,
  MessageSquarePlus,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { AlumniBadge } from "@/components/brand/StatusBadge";
import { Avatar } from "@/components/rooms/Avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TraceEvent, TriageReport } from "@/types/memory";

const RISK_STYLE: Record<TriageReport["risk"]["level"], string> = {
  LOW: "border-reusable-border bg-reusable-bg text-reusable",
  MEDIUM: "border-modified-border bg-modified-bg text-modified",
  HIGH: "border-net-new-border bg-net-new-bg text-net-new",
  CRITICAL: "border-net-new bg-net-new text-white",
};
const CITATION = /(\[CASE-\d{4}-\d{3}\])/g;

function Cited({ text, onCaseClick }: { text: string; onCaseClick: (code: string) => void }) {
  return (
    <>
      {text.split(CITATION).map((part, index) =>
        index % 2 === 1 ? (
          <button
            key={index}
            type="button"
            onClick={() => onCaseClick(part.slice(1, -1))}
            className="mx-0.5 border px-1 font-mono text-xs text-navy hover:bg-surface-2"
          >
            {part.slice(1, -1)}
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Block({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col border">
      <header className="flex items-center gap-2 border-b bg-surface-2 px-4 py-2.5">
        {icon}
        <span className="micro-label text-navy">{title}</span>
      </header>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

interface TriageReportPanelProps {
  report: TriageReport;
  trace: TraceEvent[];
  departmentCodes: Record<string, string>;
  memberIds: Set<string>;
  canAct: boolean;
  onCaseClick: (code: string) => void;
  onAddMember: (userId: string) => void;
  onPostQuestions: (text: string) => void;
}

export function TriageReportPanel({
  report,
  trace,
  departmentCodes,
  memberIds,
  canAct,
  onCaseClick,
  onAddMember,
  onPostQuestions,
}: TriageReportPanelProps) {
  const [showTrace, setShowTrace] = useState(false);
  const effort = report.effort;
  const questionsText = report.missing_info.map((q, i) => `${i + 1}. ${q.question}`).join("\n");

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 border border-navy p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-6 items-center justify-center bg-navy text-white">
            <Bot className="size-3.5" aria-hidden />
          </span>
          <SectionLabel>Dejavu triage</SectionLabel>
          <span className={cn("micro-label ml-auto border px-2 py-0.5", RISK_STYLE[report.risk.level])}>
            Risk · {report.risk.level}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-ink">
          <Cited text={report.summary} onCaseClick={onCaseClick} />
        </p>
        <button
          type="button"
          onClick={() => setShowTrace((v) => !v)}
          className="micro-label flex w-fit items-center gap-1.5 text-muted-foreground hover:text-ink"
          aria-expanded={showTrace}
        >
          <ShieldCheck className="size-3.5" aria-hidden />
          How I found this · {report.investigation.tool_calls} tool calls
          {report.investigation.cases_opened.length > 0 && ` · opened ${report.investigation.cases_opened.join(", ")}`}
          <ChevronDown className={cn("size-3.5 transition-transform", showTrace && "rotate-180")} aria-hidden />
        </button>
        {showTrace && (
          <ol className="flex flex-col border-l-2 border-navy pl-3">
            {trace.map((event) => (
              <li key={event.id} className="py-1 text-xs">
                <span className="text-ink">{event.label}</span>
                <span className="text-muted-foreground"> — {event.detail}</span>
              </li>
            ))}
            <li className="py-1 text-[11px] text-muted-foreground">
              {report.investigation.model}
              {report.fallback && " · report written by the fallback (the model was unavailable)"}
              {report.guard_warnings.length > 0 && ` · ${report.guard_warnings.length} unverifiable reference(s) removed`}
            </li>
          </ol>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        <Block title="Risk & effort" icon={<CalendarClock className="size-3.5 text-navy" aria-hidden />}>
          {effort?.median_days != null ? (
            <div className="grid grid-cols-2 gap-px bg-hairline">
              <div className="flex flex-col gap-0.5 bg-background p-3">
                <span className="micro-label text-muted-foreground">Similar cases took</span>
                <span className="text-lg font-medium text-ink">
                  {effort.range_days ? `${effort.range_days[0]}–${effort.range_days[1]}` : effort.median_days} days
                </span>
                <span className="text-xs text-muted-foreground">median {effort.median_days}</span>
              </div>
              <div className="flex flex-col gap-0.5 bg-background p-3">
                <span className="micro-label text-muted-foreground">Deadline</span>
                <span
                  className={cn(
                    "text-lg font-medium",
                    effort.fits_deadline === false ? "text-destructive" : "text-ink",
                  )}
                >
                  {effort.days_until_deadline != null ? `${effort.days_until_deadline} days` : "Not set"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {effort.fits_deadline === false
                    ? "Tighter than past cases"
                    : effort.fits_deadline
                      ? "Within the usual range"
                      : "Set a deadline to compare"}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No past durations to compare with.</p>
          )}
          {report.risk.reasons.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {report.risk.reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-sm text-ink">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-modified" aria-hidden />
                  <Cited text={reason} onCaseClick={onCaseClick} />
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title={`Team to engage · ${report.team.length}`} icon={<UserPlus className="size-3.5 text-navy" aria-hidden />}>
          {report.team.length === 0 && <p className="text-sm text-muted-foreground">Nobody found for these precedents.</p>}
          <ul className="flex flex-col gap-3">
            {report.team.map((person) => {
              const inCase = memberIds.has(person.user_id);
              return (
                <li key={person.user_id} className="flex items-start gap-2.5">
                  <Avatar initials={initials(person.name)} muted={!person.active} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                      {person.name}
                      {person.department_id && (
                        <span className="micro-label border px-1 text-[10px] text-muted-foreground">
                          {departmentCodes[person.department_id] ?? person.department_id}
                        </span>
                      )}
                      {!person.active && <AlumniBadge>ALUMNI</AlumniBadge>}
                    </span>
                    {person.job_title && <span className="text-xs text-muted-foreground">{person.job_title}</span>}
                    <span className="text-xs text-ink">
                      <Cited text={person.reason} onCaseClick={onCaseClick} />
                    </span>
                    {!person.active && person.handoff && person.handoff.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Has left — ask {person.handoff.map((h) => h.name).join(" or ")}
                      </span>
                    )}
                  </div>
                  {person.active &&
                    canAct &&
                    (inCase ? (
                      <span className="micro-label shrink-0 text-muted-foreground">In case</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1"
                        onClick={() => onAddMember(person.user_id)}
                      >
                        <UserPlus className="size-3.5" aria-hidden /> Add
                      </Button>
                    ))}
                </li>
              );
            })}
          </ul>
        </Block>

        <Block
          title={`Ask the client first · ${report.missing_info.length}`}
          icon={<CircleHelp className="size-3.5 text-navy" aria-hidden />}
        >
          {report.missing_info.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing missing compared with past cases.</p>
          ) : (
            <>
              <ol className="flex flex-col gap-2.5">
                {report.missing_info.map((item, index) => (
                  <li key={item.question} className="flex gap-2 text-sm">
                    <span className="micro-label mt-0.5 text-navy">{index + 1}</span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-ink">{item.question}</span>
                      <span className="text-xs text-muted-foreground">
                        <Cited text={item.why} onCaseClick={onCaseClick} />
                        {item.source_case_code && !item.why.includes(item.source_case_code) && (
                          <>
                            {" "}
                            <Cited text={`[${item.source_case_code}]`} onCaseClick={onCaseClick} />
                          </>
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void navigator.clipboard?.writeText(questionsText)}
                >
                  <Copy className="size-3.5" aria-hidden /> Copy questions
                </Button>
                {canAct && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => onPostQuestions(`Questions to send the client before we start:\n${questionsText}`)}
                  >
                    <MessageSquarePlus className="size-3.5" aria-hidden /> Post to channel
                  </Button>
                )}
              </div>
            </>
          )}
        </Block>

        <Block
          title={`Duplicate check · ${report.duplicates.length}`}
          icon={<Copy className="size-3.5 text-navy" aria-hidden />}
        >
          {report.duplicates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active case overlaps with this request.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {report.duplicates.map((dup) => (
                <li key={dup.case_code} className="flex flex-col gap-1 border-l-2 border-modified pl-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onCaseClick(dup.case_code)}
                      className="micro-label text-navy underline-offset-2 hover:underline"
                    >
                      {dup.case_code}
                    </button>
                    {dup.same_client && <span className="micro-label border px-1 text-[10px]">Same client</span>}
                    {dup.similarity != null && (
                      <span className="micro-label text-muted-foreground">{dup.similarity}% similar</span>
                    )}
                  </span>
                  <span className="truncate text-sm text-ink">{dup.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {dup.reason}
                    {dup.owner && ` · owner ${dup.owner}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}
