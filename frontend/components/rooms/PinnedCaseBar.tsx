import { PanelLeft, PanelRight, Pin } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SocketStatus } from "@/types/realtime";
import type { CaseRef, PinnedCase } from "@/types/rooms";

const NONE = "NONE";

interface PinnedCaseBarProps {
  roomName: string;
  pinned: PinnedCase | null;
  options: CaseRef[];
  onPin: (caseId: string | null) => void;
  isPinning: boolean;
  status: SocketStatus;
  roomsOpen: boolean;
  /** Unread messages in the other rooms: shown on the toggle while the rooms panel is hidden. */
  otherUnread: number;
  onToggleRooms: () => void;
  contextOpen: boolean;
  onToggleContext: () => void;
}

const STATUS: Record<SocketStatus, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-reusable-dot" },
  connecting: { label: "Connecting", dot: "bg-modified-dot" },
  offline: { label: "Offline · polling", dot: "bg-net-new-dot" },
};

/** `■ 02 / #LEGAL` header with the room's current problem. */
export function PinnedCaseBar({
  roomName,
  pinned,
  options,
  onPin,
  isPinning,
  status,
  roomsOpen,
  otherUnread,
  onToggleRooms,
  contextOpen,
  onToggleContext,
}: PinnedCaseBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
      <PanelToggle
        label={roomsOpen ? "Hide rooms and members" : "Show rooms and members"}
        pressed={roomsOpen}
        onClick={onToggleRooms}
        badge={!roomsOpen ? otherUnread : 0}
      >
        <PanelLeft className="size-4" />
      </PanelToggle>
      <h2 className="micro-label flex items-center gap-2 text-navy">
        <span aria-hidden className="size-2 bg-navy" />
        02 / # {roomName}
      </h2>
      <span className="micro-label flex items-center gap-1.5 text-muted-foreground" role="status">
        <span aria-hidden className={cn("size-1.5", STATUS[status].dot)} />
        {STATUS[status].label}
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="micro-label hidden text-muted-foreground xl:inline">Current problem</span>
        <Select value={pinned?.id ?? NONE} onValueChange={(value) => onPin(value === NONE ? null : value)} disabled={isPinning}>
          <SelectTrigger className="h-8 min-w-0 max-w-80" aria-label="Current problem">
            <SelectValue placeholder="None pinned" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={NONE}>None pinned</SelectItem>
            {pinned && !options.some((o) => o.id === pinned.id) && (
              <SelectItem value={pinned.id}>
                {pinned.case_code} · {pinned.title}
              </SelectItem>
            )}
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.case_code} · {option.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PanelToggle
          label={contextOpen ? "Hide Dejavu context" : "Show Dejavu context"}
          pressed={contextOpen}
          onClick={onToggleContext}
        >
          <PanelRight className="size-4" />
        </PanelToggle>
      </div>
    </div>
  );
}

interface PanelToggleProps {
  label: string;
  pressed: boolean;
  onClick: () => void;
  badge?: number;
  children: ReactNode;
}

export function PanelToggle({ label, pressed, onClick, badge = 0, children }: PanelToggleProps) {
  return (
    <Button
      variant={pressed ? "secondary" : "ghost"}
      size="icon"
      className="relative size-8 shrink-0"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {children}
      {badge > 0 && (
        <span className="micro-label absolute -top-1 -right-1 bg-navy px-1 text-[10px] text-white">{badge}</span>
      )}
    </Button>
  );
}
