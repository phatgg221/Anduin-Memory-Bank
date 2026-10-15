import { ArrowLeft, CheckCheck, PanelLeft, PanelRight } from "lucide-react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SeverityBadge } from "@/components/cases/SeverityBadge";
import { PanelToggle } from "@/components/rooms/PanelToggle";
import { cn } from "@/lib/utils";
import type { SocketStatus } from "@/types/realtime";
import { SOURCE_TYPES, type ThreadView } from "@/types/rooms";

interface CaseHeaderProps {
  thread: ThreadView;
  status: SocketStatus;
  onComplete?: () => void;
  onBack: () => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
}

const DOT: Record<SocketStatus, string> = { live: "bg-reusable-dot", connecting: "bg-modified-dot", offline: "bg-net-new-dot" };

export function CaseHeader({ thread, status, onComplete, onBack, leftOpen, onToggleLeft, rightOpen, onToggleRight }: CaseHeaderProps) {
  const source = SOURCE_TYPES.find((s) => s.id === thread.source_type)?.label;
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3 sm:px-6">
      <PanelToggle label="Back to all cases" pressed={false} onClick={onBack}>
        <ArrowLeft className="size-4" />
      </PanelToggle>
      <PanelToggle label={leftOpen ? "Hide case details" : "Show case details"} pressed={leftOpen} onClick={onToggleLeft}>
        <PanelLeft className="size-4" />
      </PanelToggle>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="micro-label flex min-w-0 items-center gap-2 text-navy" title={`#${thread.channel_slug}`}>
            <span aria-hidden className="size-2 shrink-0 bg-navy" />
            <span className="truncate">02 / # {thread.channel_slug}</span>
          </span>
          <SeverityBadge severity={thread.severity} className="shrink-0 py-0" />
          <span className="micro-label flex shrink-0 items-center gap-1.5 text-muted-foreground" role="status">
            <span aria-hidden className={cn("size-1.5", DOT[status])} />
            {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline · polling"}
          </span>
        </div>
        <h2 className="truncate text-base font-medium text-ink" title={thread.title}>
          {thread.client_name ? `${thread.client_name} — ` : ""}
          {thread.fund_name ?? thread.title}
        </h2>
        <p className="truncate text-xs text-muted-foreground">
          {thread.case_code}
          {source && ` · Source: ${source}`}
          {thread.created_by && ` · Logged by ${thread.created_by.name}`}
          {thread.lead && ` · Owner ${thread.lead.name}`}
        </p>
      </div>
      {onComplete ? (
        <ActionButton icon="arrow" className="hidden w-60 shrink-0 md:flex" onClick={onComplete}>
          <span className="flex items-center gap-1.5">
            <CheckCheck className="size-4" aria-hidden /> Complete &amp; save to memory
          </span>
        </ActionButton>
      ) : (
        <span className="micro-label hidden shrink-0 border border-reusable-border bg-reusable-bg px-2 py-1 text-reusable md:inline">
          In memory
        </span>
      )}
      <PanelToggle label={rightOpen ? "Hide reusable kit" : "Show reusable kit"} pressed={rightOpen} onClick={onToggleRight}>
        <PanelRight className="size-4" />
      </PanelToggle>
    </div>
  );
}
