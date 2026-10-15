import { SectionLabel } from "@/components/brand/SectionLabel";
import type { RoomPerson } from "@/types/rooms";
import { Avatar } from "./Avatar";

/** People who have posted in a case thread, with online status. */
export function ParticipantList({ people, onlineIds, currentUserId }: { people: RoomPerson[]; onlineIds: Set<string>; currentUserId: string }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>
        Thread participants · {people.length}
        {onlineIds.size > 0 && ` · ${onlineIds.size} here`}
      </SectionLabel>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">No one has posted yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-2 text-sm">
              <span className="relative">
                <Avatar initials={person.avatar_initials} muted={!person.is_active} />
                {onlineIds.has(person.id) && (
                  <span aria-label="Online" className="absolute -right-0.5 -bottom-0.5 size-2.5 border-2 border-surface-2 bg-reusable-dot" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ink">
                  {person.name}
                  {person.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                </span>
                {person.job_title && <span className="truncate text-xs text-muted-foreground">{person.job_title}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
