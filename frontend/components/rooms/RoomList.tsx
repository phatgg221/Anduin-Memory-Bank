import { CornerDownRight, Plus } from "lucide-react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { cn } from "@/lib/utils";
import type { RoomSummary, ThreadSummary } from "@/types/rooms";

interface RoomListProps {
  rooms: RoomSummary[];
  activeId: string | null;
  onSelect: (departmentId: string) => void;
  /** Case threads of the active room, shown nested under it. */
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onSelectThread: (caseId: string) => void;
  onNewThread: () => void;
  isCreatingThread: boolean;
}

/** `■ 01 / ROOMS` — one war room per department; the active room lists its case threads (sub-chats). */
export function RoomList({
  rooms,
  activeId,
  onSelect,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  isCreatingThread,
}: RoomListProps) {
  return (
    <nav aria-label="Department rooms" className="flex flex-col gap-3">
      <SectionLabel index={1}>Rooms</SectionLabel>
      <ul className="flex flex-col">
        {rooms.map((room) => {
          const active = room.department_id === activeId;
          const roomSelected = active && !activeThreadId && !isCreatingThread;
          return (
            <li key={room.department_id} className="flex flex-col">
              <button
                type="button"
                onClick={() => onSelect(room.department_id)}
                aria-current={roomSelected ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-sm hover:bg-background",
                  roomSelected && "border-navy bg-background font-medium text-ink",
                  active && !roomSelected && "border-navy/40 font-medium text-ink",
                  !active && "border-transparent text-muted-foreground",
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

              {active && (
                <ul aria-label={`Case threads in ${room.name}`} className="flex flex-col border-l-2 border-navy/40 pb-1">
                  {threads.map((thread) => {
                    const selected = thread.id === activeThreadId;
                    return (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => onSelectThread(thread.id)}
                          aria-current={selected ? "true" : undefined}
                          className={cn(
                            "flex w-full items-start gap-2 py-1.5 pr-3 pl-5 text-left hover:bg-background",
                            selected ? "bg-background text-ink" : "text-muted-foreground",
                          )}
                        >
                          <CornerDownRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="micro-label whitespace-nowrap text-navy">{thread.case_code}</span>
                            <span className="truncate text-xs">
                              {(thread.severity === "CRITICAL" || thread.severity === "HIGH") && (
                                <span className={thread.severity === "CRITICAL" ? "font-medium text-net-new" : "font-medium text-modified"}>
                                  {thread.severity} ·{" "}
                                </span>
                              )}
                              {thread.client_name ? `${thread.client_name} · ` : ""}
                              {thread.title}
                            </span>
                          </span>
                          <span className="micro-label text-muted-foreground" aria-label={`${thread.message_count} messages`}>
                            {thread.message_count}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  <li>
                    <button
                      type="button"
                      onClick={onNewThread}
                      className={cn(
                        "flex w-full items-center gap-2 py-1.5 pr-3 pl-5 text-left text-xs hover:bg-background",
                        isCreatingThread ? "bg-background text-ink" : "text-muted-foreground",
                      )}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      New case thread
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
