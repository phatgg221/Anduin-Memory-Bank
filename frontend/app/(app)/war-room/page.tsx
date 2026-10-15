"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Composer } from "@/components/rooms/Composer";
import { ContextPane } from "@/components/rooms/ContextPane";
import { MemberList } from "@/components/rooms/MemberList";
import { MessageThread } from "@/components/rooms/MessageThread";
import { PanelToggle, PinnedCaseBar } from "@/components/rooms/PinnedCaseBar";
import { RoomList } from "@/components/rooms/RoomList";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useSession } from "@/store/auth";
import { useDepartments, useSetActiveDepartment } from "@/store/org";
import {
  useChangeMember,
  useMarkRead,
  usePeople,
  useRoom,
  useRoomPolling,
  useRoomSocket,
  useRooms,
  useSendMessage,
  useSetPinnedCase,
} from "@/store/rooms";
import { useOpenArtifact } from "@/store/vault";
import { PanelLeft } from "lucide-react";
import type { RoomPerson } from "@/types/rooms";

type Panel = "rooms" | "context";

export default function WarRoomPage() {
  const router = useRouter();
  const user = useSession().data?.user;
  const signedIn = Boolean(user);
  const roomId = user?.active_department_id ?? null;

  const rooms = useRooms(signedIn);
  const people = usePeople(signedIn);
  const departments = useDepartments(signedIn);
  const room = useRoom(signedIn ? roomId : null);

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

  const socket = useRoomSocket(roomId, me);
  useRoomPolling(roomId, room.isSuccess, socket.status === "live");
  const onlineIds = useMemo(() => new Set(socket.online.map((p) => p.id)), [socket.online]);

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

  // Side panels: columns that collapse on wide screens, slide-over drawers on narrow ones. The chat always stays.
  const isWide = useMediaQuery("(min-width: 1024px)");
  const [wideOpen, setWideOpen] = useState<Record<Panel, boolean>>({ rooms: true, context: true });
  const [drawer, setDrawer] = useState<Panel | null>(null);
  const isOpen = (panel: Panel) => (isWide ? wideOpen[panel] : drawer === panel);
  const toggle = (panel: Panel) => {
    if (isWide) setWideOpen((open) => ({ ...open, [panel]: !open[panel] }));
    else setDrawer((current) => (current === panel ? null : panel));
  };
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  const panelClass = (panel: Panel) =>
    cn(
      "flex-col overflow-y-auto bg-surface-2",
      !isOpen(panel) && "hidden",
      isOpen(panel) && (isWide ? "flex shrink-0" : "fixed top-14 bottom-0 z-30 flex w-[min(340px,88vw)]"),
      panel === "rooms" ? "left-0 border-r lg:w-[260px]" : "right-0 border-l lg:w-[340px]",
    );
  const otherUnread = (rooms.data ?? [])
    .filter((r) => r.department_id !== roomId)
    .reduce((sum, r) => sum + r.unread_count, 0);

  const error = selectRoom.error ?? changeMember.error ?? pin.error ?? openArtifact.error ?? room.error;

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem)]">
      {drawer && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => setDrawer(null)}
          className="fixed inset-x-0 top-14 bottom-0 z-20 bg-navy/20 lg:hidden"
        />
      )}

      <aside aria-label="Rooms and members" className={cn(panelClass("rooms"), "gap-8 p-6")}>
        {rooms.data ? (
          <RoomList
            rooms={rooms.data}
            activeId={roomId}
            onSelect={(id) => {
              selectRoom.mutate(id);
              setDrawer(null);
            }}
          />
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
            onlineIds={onlineIds}
            onAdd={(person) => changeMember.mutate({ kind: "add", person })}
            onRemove={(userId) => changeMember.mutate({ kind: "remove", userId })}
          />
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!roomId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            {!isOpen("rooms") && (
              <PanelToggle label="Show rooms" pressed={false} onClick={() => toggle("rooms")} badge={otherUnread}>
                <PanelLeft className="size-4" />
              </PanelToggle>
            )}
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
              status={socket.status}
              roomsOpen={isOpen("rooms")}
              otherUnread={otherUnread}
              onToggleRooms={() => toggle("rooms")}
              contextOpen={isOpen("context")}
              onToggleContext={() => toggle("context")}
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
            <Composer
              roomName={view.code.toLowerCase()}
              onSend={handleSend}
              onTyping={socket.notifyTyping}
              typingNames={socket.typing.map((t) => t.name)}
              error={send.error?.message}
            />
          </>
        ) : (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-64" />
          </div>
        )}
      </section>

      <aside aria-label="Dejavu context" className={cn(panelClass("context"), "bg-background")}>
        <ContextPane pinned={view?.pinned_case ?? null} />
      </aside>
    </div>
  );
}
