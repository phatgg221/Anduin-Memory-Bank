import { SectionLabel } from "@/components/brand/SectionLabel";
import { cn } from "@/lib/utils";
import type { RoomSummary } from "@/types/rooms";

interface RoomListProps {
  rooms: RoomSummary[];
  activeId: string | null;
  onSelect: (departmentId: string) => void;
}

/** `■ 01 / ROOMS` — one war room per department, with unread counts. */
export function RoomList({ rooms, activeId, onSelect }: RoomListProps) {
  return (
    <nav aria-label="Department rooms" className="flex flex-col gap-3">
      <SectionLabel index={1}>Rooms</SectionLabel>
      <ul className="flex flex-col">
        {rooms.map((room) => {
          const active = room.department_id === activeId;
          return (
            <li key={room.department_id}>
              <button
                type="button"
                onClick={() => onSelect(room.department_id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-sm hover:bg-background",
                  active ? "border-navy bg-background font-medium text-ink" : "border-transparent text-muted-foreground",
                )}
              >
                <span className="font-mono text-xs">#</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{room.name}</span>
                  {room.lead && (
                    <span className="truncate text-xs font-normal text-muted-foreground">Lead · {room.lead.name}</span>
                  )}
                </span>
                {room.unread_count > 0 && (
                  <span className="micro-label bg-navy px-1.5 py-0.5 text-white" aria-label={`${room.unread_count} unread`}>
                    {room.unread_count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
