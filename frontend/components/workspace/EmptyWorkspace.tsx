import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import type { ThreadSummary } from "@/types/rooms";

/** No case selected: the brand illustration plus quick starts into active cases. */
export function EmptyWorkspace({ rooms, onOpen }: { rooms: ThreadSummary[]; onOpen: (caseId: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
      <IsometricStack />
      <SectionLabel as="p">No case open</SectionLabel>
      <p className="max-w-md text-sm text-muted-foreground">
        Load a demo scenario or paste an incoming problem on the left and run the analysis, or jump into an active case
        room below.
      </p>
      {rooms.length > 0 && (
        <div className="grid w-full max-w-3xl grid-cols-1 gap-2 text-left sm:grid-cols-3">
          {rooms.slice(0, 3).map((room) => (
            <button key={room.id} type="button" onClick={() => onOpen(room.id)} className="flex flex-col gap-1.5 border p-3 hover:bg-surface-2">
              <span className="micro-label text-navy">{room.case_code}</span>
              <span className="line-clamp-2 text-sm text-ink">{room.client_name ?? room.title}</span>
              <span className="text-xs text-muted-foreground">
                {room.top_match_score !== null ? `${room.top_match_score}% top match · ` : ""}
                {room.message_count} messages
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
