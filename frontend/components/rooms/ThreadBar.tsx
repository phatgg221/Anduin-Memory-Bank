import { ArrowLeft, BookmarkCheck, PanelLeft, PanelRight } from "lucide-react";
import { SeverityBadge } from "@/components/cases/SeverityBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SocketStatus } from "@/types/realtime";
import type { Severity } from "@/types/rooms";
import { PanelToggle } from "./PinnedCaseBar";

interface ThreadBarProps {
  roomCode: string;
  caseCode: string;
  title: string;
  severity: Severity;
  clientName: string | null;
  departments: string[];
  status: SocketStatus;
  onBack: () => void;
  roomsOpen: boolean;
  onToggleRooms: () => void;
  contextOpen: boolean;
  onToggleContext: () => void;
  /** Shown while the case is open: starts the AI summarizer and opens the review. */
  onResolve?: () => void;
  backLabel?: string;
}

const DOT: Record<SocketStatus, string> = {
  live: "bg-reusable-dot",
  connecting: "bg-modified-dot",
  offline: "bg-net-new-dot",
};

/** `02 / # ops › CASE-2026-047` — header of a case thread inside a department room. */
export function ThreadBar(props: ThreadBarProps) {
  const { roomCode, caseCode, title, departments, status, onBack } = props;
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
      <PanelToggle
        label={props.roomsOpen ? "Hide rooms and members" : "Show rooms and members"}
        pressed={props.roomsOpen}
        onClick={props.onToggleRooms}
      >
        <PanelLeft className="size-4" />
      </PanelToggle>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
          <button
            type="button"
            onClick={onBack}
            className="micro-label flex shrink-0 items-center gap-1 text-muted-foreground hover:text-navy"
          >
            <ArrowLeft className="size-3" aria-hidden /> {props.backLabel ?? `# ${roomCode}`}
          </button>
          <span className="micro-label text-muted-foreground">›</span>
          <span className="micro-label text-navy">{caseCode}</span>
          <SeverityBadge severity={props.severity} className="py-0" />
          <span className="micro-label flex items-center gap-1.5 text-muted-foreground" role="status">
            <span aria-hidden className={cn("size-1.5", DOT[status])} />
            {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline · polling"}
          </span>
        </div>
        <h2 className="truncate text-sm font-medium text-ink" title={title}>
          {props.clientName && <span className="text-muted-foreground">{props.clientName} · </span>}
          {title}
        </h2>
      </div>
      <div className="hidden items-center gap-1 xl:flex">
        {departments.map((code, index) => (
          <span
            key={code}
            className={cn(
              "micro-label px-1.5 py-0.5",
              index === 0 ? "bg-navy text-white" : "border text-muted-foreground",
            )}
          >
            {code}
          </span>
        ))}
      </div>
      {props.onResolve && (
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5 border-ink" onClick={props.onResolve}>
          <BookmarkCheck className="size-4" aria-hidden />
          <span className="hidden sm:inline">Resolve &amp; commit</span>
        </Button>
      )}
      <PanelToggle
        label={props.contextOpen ? "Hide Dejavu context" : "Show Dejavu context"}
        pressed={props.contextOpen}
        onClick={props.onToggleContext}
      >
        <PanelRight className="size-4" />
      </PanelToggle>
    </div>
  );
}
