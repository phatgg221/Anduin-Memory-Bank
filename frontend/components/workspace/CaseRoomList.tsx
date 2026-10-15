import { SectionLabel } from "@/components/brand/SectionLabel";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@/types/rooms";

interface CaseRoomListProps {
  rooms: ThreadSummary[];
  activeCaseId: string | null;
  departmentCodes: Record<string, string>;
  onSelect: (caseId: string) => void;
  /** The department's general room (the war room), shown first. */
  departmentRoom: { code: string; unread: number } | null;
  departmentRoomActive: boolean;
  onSelectDepartmentRoom: () => void;
}

/** `■ ACTIVE CASE ROOMS` — open cases (for the header's department, or all). */
export function CaseRoomList({
  rooms,
  activeCaseId,
  departmentCodes,
  onSelect,
  departmentRoom,
  departmentRoomActive,
  onSelectDepartmentRoom,
}: CaseRoomListProps) {
  return (
    <nav aria-label="Active case rooms" className="flex flex-col gap-3">
      <SectionLabel>Active case rooms · {rooms.length}</SectionLabel>
      <ul className="flex flex-col">
        {departmentRoom && (
          <li>
            <button
              type="button"
              onClick={onSelectDepartmentRoom}
              aria-current={departmentRoomActive ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left hover:bg-background",
                departmentRoomActive ? "border-navy bg-background" : "border-transparent",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-xs text-ink"># {departmentRoom.code.toLowerCase()}</span>
                <span className="text-xs text-muted-foreground">Department room · general discussion</span>
              </span>
              {departmentRoom.unread > 0 && <span className="micro-label bg-navy px-1.5 py-0.5 text-white">{departmentRoom.unread}</span>}
            </button>
          </li>
        )}
        {rooms.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No open cases here yet.</li>}
        {rooms.map((room) => {
          const active = room.id === activeCaseId;
          return (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => onSelect(room.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-1 border-l-2 px-3 py-2 text-left hover:bg-background",
                  active ? "border-navy bg-background" : "border-transparent",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className={cn("size-2 shrink-0", active ? "bg-navy" : "bg-hairline")} aria-hidden />
                  <span className="micro-label whitespace-nowrap text-navy">{room.case_code}</span>
                  {(room.severity === "CRITICAL" || room.severity === "HIGH") && (
                    <span className={cn("micro-label text-[10px]", room.severity === "CRITICAL" ? "text-net-new" : "text-modified")}>{room.severity}</span>
                  )}
                </span>
                <span className="truncate text-xs text-ink">
                  {room.client_name ? `${room.client_name} · ` : ""}
                  {room.title}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="micro-label border px-1">{departmentCodes[room.department_id] ?? room.department_id}</span>
                  {room.top_match_score !== null && <span>{room.top_match_score}% match</span>}
                  <span>· {room.message_count} msg{room.message_count === 1 ? "" : "s"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
