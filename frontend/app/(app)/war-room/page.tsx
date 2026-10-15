"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Composer } from "@/components/rooms/Composer";
import { ContextPane } from "@/components/rooms/ContextPane";
import { MemberList } from "@/components/rooms/MemberList";
import { MessageThread } from "@/components/rooms/MessageThread";
import { PinnedCaseBar } from "@/components/rooms/PinnedCaseBar";
import { RoomList } from "@/components/rooms/RoomList";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/store/auth";
import { useDepartments, useSetActiveDepartment } from "@/store/org";
import {
  useChangeMember,
  useMarkRead,
  usePeople,
  useRoom,
  useRoomPolling,
  useRooms,
  useSendMessage,
  useSetPinnedCase,
} from "@/store/rooms";
import { useOpenArtifact } from "@/store/vault";
import type { RoomPerson } from "@/types/rooms";

export default function WarRoomPage() {
  const router = useRouter();
  const user = useSession().data?.user;
  const signedIn = Boolean(user);
  const roomId = user?.active_department_id ?? null;

  const rooms = useRooms(signedIn);
  const people = usePeople(signedIn);
  const departments = useDepartments(signedIn);
  const room = useRoom(signedIn ? roomId : null);
  useRoomPolling(roomId, room.isSuccess);

  const selectRoom = useSetActiveDepartment();
  const send = useSendMessage(roomId ?? "");
  const markRead = useMarkRead(roomId ?? "");
  const changeMember = useChangeMember(roomId ?? "");
  const pin = useSetPinnedCase(roomId ?? "");
  const openArtifact = useOpenArtifact();

  const departmentCodes = useMemo(
    () => Object.fromEntries((departments.data ?? []).map((d) => [d.id, d.code])),
    [departments.data],
  );
  const me: RoomPerson | undefined = useMemo(
    () =>
      user && {
        id: user.id,
        name: user.name,
        avatar_initials: user.avatar_initials,
        job_title: user.job_title,
        primary_department_id: user.primary_department_id,
        is_active: true,
        departed_at: null,
      },
    [user],
  );

  // Reading the room moves the read marker to the newest confirmed message.
  const view = room.data;
  const newestSeq = view?.messages.reduce((max, m) => (m.pending ? max : Math.max(max, m.seq)), 0) ?? 0;
  const { mutate: markReadUpTo } = markRead;
  useEffect(() => {
    if (view && newestSeq > view.last_read_seq && document.visibilityState === "visible") markReadUpTo(newestSeq);
  }, [view, newestSeq, markReadUpTo]);

  const handleOpenArtifact = (artifactId: string) => {
    const tab = window.open("", "_blank");
    openArtifact.mutate(artifactId, {
      onSuccess: ({ url }) => {
        if (!tab) return void window.open(url, "_blank", "noopener");
        tab.opener = null;
        tab.location.href = url;
      },
      onError: () => tab?.close(),
    });
  };

  const handleCaseClick = (caseCode: string) => {
    const option = view?.case_options.find((c) => c.case_code === caseCode);
    if (option) pin.mutate(option.id);
    else router.push("/vault");
  };

  const handleSend = (content: string, isMilestone: boolean) => {
    if (!me) return;
    send.mutate({ input: { id: crypto.randomUUID(), content, is_milestone: isMilestone }, author: me });
  };

  const error = selectRoom.error ?? changeMember.error ?? pin.error ?? openArtifact.error ?? room.error;

  return (
    <div className="grid h-[calc(100dvh-3.5rem)] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px] lg:divide-x">
      <aside className="flex flex-col gap-8 overflow-y-auto bg-surface-2 p-6">
        {rooms.data ? (
          <RoomList rooms={rooms.data} activeId={roomId} onSelect={(id) => selectRoom.mutate(id)} />
        ) : (
          <Skeleton className="h-56" />
        )}
        {view && me && (
          <MemberList
            members={view.members}
            people={people.data ?? []}
            currentUserId={me.id}
            isMember={view.is_member}
            departmentCodes={departmentCodes}
            onAdd={(person) => changeMember.mutate({ kind: "add", person })}
            onRemove={(userId) => changeMember.mutate({ kind: "remove", userId })}
          />
        )}
      </aside>

      <section className="flex min-h-0 flex-col">
        {!roomId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <IsometricStack />
            <SectionLabel as="p">Pick a department room</SectionLabel>
            <p className="max-w-sm text-sm text-muted-foreground">
              Every department has one war room. Choose one on the left, or pick a department in the header.
            </p>
          </div>
        ) : view ? (
          <>
            <PinnedCaseBar
              roomName={view.code.toLowerCase()}
              pinned={view.pinned_case}
              options={view.case_options}
              onPin={(caseId) => pin.mutate(caseId)}
              isPinning={pin.isPending}
            />
            {error && (
              <p role="alert" className="border-b border-destructive px-6 py-2 text-sm text-destructive">
                {error.message}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {view.messages.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No messages yet. Start the conversation for {view.name}.
                </p>
              ) : (
                <MessageThread
                  messages={view.messages}
                  lastReadSeq={view.last_read_seq}
                  currentUserId={user!.id}
                  onOpenArtifact={handleOpenArtifact}
                  onCaseClick={handleCaseClick}
                />
              )}
            </div>
            <Composer roomName={view.code.toLowerCase()} onSend={handleSend} error={send.error?.message} />
          </>
        ) : (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-64" />
          </div>
        )}
      </section>

      <aside className="overflow-y-auto">
        <ContextPane pinned={view?.pinned_case ?? null} />
      </aside>
    </div>
  );
}
