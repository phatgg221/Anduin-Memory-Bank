import { Check, Lock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RoomPerson } from "@/types/rooms";
import { Avatar } from "./Avatar";

interface LockedChatProps {
  title: string;
  description: string;
  members: RoomPerson[];
  requested: boolean;
  onRequest: () => void;
  isRequesting: boolean;
  error?: string;
}

export function LockedChat({
  title,
  description,
  members,
  requested,
  onRequest,
  isRequesting,
  error,
}: LockedChatProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 border p-6 text-center">
        <span className="flex size-10 items-center justify-center bg-navy text-white">
          <Lock className="size-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-navy">{title}</span>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {members.length > 0 && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex -space-x-1">
              {members.slice(0, 6).map((person) => (
                <span key={person.id} title={person.name} className="border-2 border-background">
                  <Avatar initials={person.avatar_initials} muted={!person.is_active} />
                </span>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {members.length} member{members.length === 1 ? "" : "s"}:{" "}
              {members
                .slice(0, 3)
                .map((p) => p.name)
                .join(", ")}
              {members.length > 3 && ` and ${members.length - 3} more`}
            </span>
          </div>
        )}
        {requested ? (
          <span className="flex items-center gap-1.5 border border-reusable-border bg-reusable-bg px-3 py-1.5 text-xs text-reusable">
            <Check className="size-3.5" aria-hidden /> Request sent · a member will add you
          </span>
        ) : (
          <Button onClick={onRequest} disabled={isRequesting} className="gap-1.5">
            <UserPlus className="size-4" aria-hidden /> Ask to join
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
