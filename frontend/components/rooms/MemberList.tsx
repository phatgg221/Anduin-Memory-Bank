"use client";

import { UserPlus, X } from "lucide-react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RoomMember, RoomPerson } from "@/types/rooms";
import { Avatar } from "./Avatar";

interface MemberListProps {
  members: RoomMember[];
  people: RoomPerson[];
  currentUserId: string;
  isMember: boolean;
  departmentCodes: Record<string, string>;
  onAdd: (person: RoomPerson) => void;
  onRemove: (userId: string) => void;
}

/** Room members: the department lead first (always in, can't be removed), then everyone else. */
export function MemberList({ members, people, currentUserId, isMember, departmentCodes, onAdd, onRemove }: MemberListProps) {
  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = people.filter((p) => !memberIds.has(p.id));
  const me = people.find((p) => p.id === currentUserId);

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Members · {members.length}</SectionLabel>
      <ul className="flex flex-col gap-2">
        {members.map(({ user, role }) => (
          <li key={user.id} className="group flex items-center gap-2 text-sm">
            <Avatar initials={user.avatar_initials} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ink">
                {user.name}
                {user.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user.job_title ?? "Member"}
                {user.primary_department_id && ` · ${departmentCodes[user.primary_department_id] ?? ""}`}
              </span>
            </span>
            {role === "LEAD" ? (
              <span className="micro-label border border-navy px-1.5 py-0.5 text-navy">Lead</span>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={user.id === currentUserId ? "Leave room" : `Remove ${user.name}`}
                onClick={() => onRemove(user.id)}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {!isMember && me && (
          <Button variant="outline" size="sm" onClick={() => onAdd(me)}>
            Join room
          </Button>
        )}
        {candidates.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <UserPlus className="size-4" />
                Add member
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="micro-label text-muted-foreground">Add to room</DropdownMenuLabel>
              {candidates.map((person) => (
                <DropdownMenuItem key={person.id} onSelect={() => onAdd(person)} className="gap-2">
                  <Avatar initials={person.avatar_initials} className="size-6" />
                  <span className="flex-1">{person.name}</span>
                  {person.primary_department_id && (
                    <span className="micro-label text-muted-foreground">
                      {departmentCodes[person.primary_department_id]}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </section>
  );
}
