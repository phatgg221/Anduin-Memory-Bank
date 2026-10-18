import { Hash, Lock, Users } from "lucide-react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { cn } from "@/lib/utils";
import type { RoomSummary } from "@/types/rooms";

interface DepartmentChannelsProps {
  rooms: RoomSummary[];
  activeDepartmentId: string | null;
  onOpen: (departmentId: string) => void;
}

export function DepartmentChannels({ rooms, activeDepartmentId, onOpen }: DepartmentChannelsProps) {
  const ordered = [...rooms].sort(
    (a, b) => Number(b.department_id === activeDepartmentId) - Number(a.department_id === activeDepartmentId),
  );
  return (
    <section aria-label="Department channels" className="flex flex-col gap-3">
      <SectionLabel index={2}>Department channels · {rooms.length}</SectionLabel>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
        {ordered.map((room) => {
          const mine = room.department_id === activeDepartmentId;
          return (
            <li key={room.department_id}>
              <button
                type="button"
                onClick={() => onOpen(room.department_id)}
                className={cn(
                  "flex h-full w-full flex-col gap-1.5 border p-3 text-left hover:bg-surface-2",
                  mine && "border-navy",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Hash className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="font-mono text-sm text-ink">{room.code.toLowerCase()}</span>
                  {mine && <span className="micro-label text-muted-foreground">Your view</span>}
                  {!room.is_member && (
                    <span
                      className="micro-label flex items-center gap-1 text-muted-foreground"
                      title="Members-only channel: open it to ask to join"
                    >
                      <Lock className="size-3" aria-hidden /> Members only
                    </span>
                  )}
                  {room.unread_count > 0 && (
                    <span className="micro-label ml-auto bg-navy px-1.5 py-0.5 text-white">{room.unread_count}</span>
                  )}
                </span>
                <span className="truncate text-sm text-ink">{room.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="size-3.5" aria-hidden />
                  {room.member_count} member{room.member_count === 1 ? "" : "s"}
                  {room.lead && ` · lead ${room.lead.name}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
