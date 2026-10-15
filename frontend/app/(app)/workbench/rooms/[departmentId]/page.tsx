"use client";

import { ArrowLeft, PanelRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo } from "react";
import { Composer } from "@/components/rooms/Composer";
import { MemberList } from "@/components/rooms/MemberList";
import { MessageThread } from "@/components/rooms/MessageThread";
import { PanelToggle } from "@/components/rooms/PanelToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneLayout } from "@/components/workspace/PaneLayout";
import { usePanels } from "@/lib/usePanels";
import { useSession } from "@/store/auth";
import { useDepartments } from "@/store/org";
import {
  useChangeMember,
  useMarkRead,
  usePeople,
  useRoom,
  useRoomCacheHandlers,
  useRoomPolling,
  useRoomSocket,
  useSendMessage,
} from "@/store/rooms";
import { useOpenCases } from "@/store/threads";
import { useOpenArtifact } from "@/store/vault";
import type { RoomPerson } from "@/types/rooms";

export default function DepartmentRoomPage({ params }: { params: Promise<{ departmentId: string }> }) {
  const { departmentId } = use(params);
  const router = useRouter();
  const user = useSession().data?.user;
  const signedIn = Boolean(user);

  const departments = useDepartments(signedIn);
  const people = usePeople(signedIn);
  const openCases = useOpenCases(null, signedIn);
  const room = useRoom(signedIn ? departmentId : null);
  const sendRoom = useSendMessage(departmentId);
  const markRead = useMarkRead(departmentId);
  const changeMember = useChangeMember(departmentId);
  const openArtifact = useOpenArtifact();
  const panels = usePanels();

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

  const handlers = useRoomCacheHandlers(departmentId);
  const socket = useRoomSocket(departmentId, me, handlers);
  useRoomPolling(departmentId, room.isSuccess, socket.status === "live");

  // Reading the room moves its read marker.
  const view = room.data;
  const newestSeq = view?.messages.reduce((max, m) => (m.pending ? max : Math.max(max, m.seq)), 0) ?? 0;
  const { mutate: markReadUpTo } = markRead;
  useEffect(() => {
    if (view && newestSeq > view.last_read_seq) markReadUpTo(newestSeq);
  }, [view, newestSeq, markReadUpTo]);

  const handleOpenArtifact = (artifactId: string) => {
    const win = window.open("", "_blank");
    openArtifact.mutate(artifactId, {
      onSuccess: ({ url }) => {
        if (!win) return void window.open(url, "_blank", "noopener");
        win.opener = null;
        win.location.href = url;
      },
      onError: () => win?.close(),
    });
  };
  const handleCaseClick = (code: string) => {
    const open = openCases.data?.find((c) => c.case_code === code);
    router.push(open ? `/workbench/cases/${open.id}` : "/vault");
  };

  if (!view || !me) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {room.error ? (
          <p role="alert" className="p-6 text-sm text-destructive">
            {room.error.message}
          </p>
        ) : (
          <Skeleton className="m-6 h-72" />
        )}
      </div>
    );
  }

  return (
    <PaneLayout
      id="dejavu-room"
      panels={panels}
      right={{
        label: "Members",
        content: (
          <div className="p-5">
            <MemberList
              members={view.members}
              people={people.data ?? []}
              currentUserId={me.id}
              isMember={view.is_member}
              departmentCodes={departmentCodes}
              onlineIds={new Set(socket.online.map((p) => p.id))}
              onAdd={(person) => changeMember.mutate({ kind: "add", person })}
              onRemove={(userId) => changeMember.mutate({ kind: "remove", userId })}
            />
          </div>
        ),
      }}
    >
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <PanelToggle label="Back to all channels" pressed={false} onClick={() => router.push("/workbench")}>
          <ArrowLeft className="size-4" />
        </PanelToggle>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="micro-label text-navy"># {view.code.toLowerCase()} · department channel</span>
          <span className="truncate text-sm text-ink">{view.name}: general discussion and triage</span>
        </div>
        <PanelToggle
          label={panels.isOpen("right") ? "Hide members" : "Show members"}
          pressed={panels.isOpen("right")}
          onClick={() => panels.toggle("right")}
        >
          <PanelRight className="size-4" />
        </PanelToggle>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageThread
          messages={view.messages}
          lastReadSeq={view.last_read_seq}
          currentUserId={me.id}
          onOpenArtifact={handleOpenArtifact}
          onCaseClick={handleCaseClick}
        />
      </div>
      <Composer
        roomName={view.code.toLowerCase()}
        onSend={(content, isMilestone) =>
          sendRoom.mutate({
            input: { id: crypto.randomUUID(), content, is_milestone: isMilestone },
            author: me,
          })
        }
        onTyping={socket.notifyTyping}
        typingNames={socket.typing.map((p) => p.name)}
        error={sendRoom.error?.message}
      />
    </PaneLayout>
  );
}
