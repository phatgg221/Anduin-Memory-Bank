"use client";

import { PanelLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Composer } from "@/components/rooms/Composer";
import { ContextPane } from "@/components/rooms/ContextPane";
import { CaseDetailsPanel } from "@/components/cases/CaseDetailsPanel";
import { JobProgress } from "@/components/memory/JobProgress";
import { MemoryBanner } from "@/components/memory/MemoryBanner";
import { MemoryReviewForm } from "@/components/memory/MemoryReviewForm";
import { MemberList } from "@/components/rooms/MemberList";
import { MessageThread } from "@/components/rooms/MessageThread";
import { NewThreadForm } from "@/components/rooms/NewThreadForm";
import { ParticipantList } from "@/components/rooms/ParticipantList";
import { PanelToggle, PinnedCaseBar } from "@/components/rooms/PinnedCaseBar";
import { RoomList } from "@/components/rooms/RoomList";
import { ThreadBar } from "@/components/rooms/ThreadBar";
import { Button } from "@/components/ui/button";
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
  useRoomCacheHandlers,
  useRoomPolling,
  useRoomSocket,
  useRooms,
  useSendMessage,
  useSetPinnedCase,
} from "@/store/rooms";
import {
  useCreateCase,
  useSendThreadMessage,
  useThread,
  useThreadCacheHandlers,
  useThreadPolling,
  useUpdateCase,
} from "@/store/threads";
import { useCaseJobs, useCommitMemory, useResolve } from "@/store/memory";
import { useOpenArtifact } from "@/store/vault";
import type { RoomPerson } from "@/types/rooms";

type Panel = "rooms" | "context";

// useSearchParams needs a Suspense boundary under Cache Components.
export default function WarRoomPage() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[60dvh]" />}>
      <WarRoom />
    </Suspense>
  );
}

function WarRoom() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The URL holds what the centre pane shows: the room chat, ?thread=<case id>, or ?new=1.
  const threadId = searchParams.get("thread");
  const creating = !threadId && searchParams.get("new") === "1";
  const reviewing = Boolean(threadId) && searchParams.get("review") === "1";

  const user = useSession().data?.user;
  const signedIn = Boolean(user);
  const roomId = user?.active_department_id ?? null;

  const rooms = useRooms(signedIn);
  const people = usePeople(signedIn);
  const departments = useDepartments(signedIn);
  const room = useRoom(signedIn ? roomId : null);
  const thread = useThread(signedIn ? threadId : null);

  const selectRoom = useSetActiveDepartment();
  const send = useSendMessage(roomId ?? "");
  const sendThread = useSendThreadMessage(threadId ?? "");
  const createCase = useCreateCase();
  const markRead = useMarkRead(roomId ?? "");
  const changeMember = useChangeMember(roomId ?? "");
  const pin = useSetPinnedCase(roomId ?? "");
  const openArtifact = useOpenArtifact();
  const jobs = useCaseJobs(signedIn ? threadId : null);
  const resolve = useResolve(threadId ?? "");
  const commitMemory = useCommitMemory(threadId ?? "");
  const updateCase = useUpdateCase(threadId ?? "");
  const [rightTab, setRightTab] = useState<"details" | "context">("details");
  const summarizeJob = jobs.data?.summarize ?? null;
  const startDraft = () => resolve.mutate(crypto.randomUUID());
  const openReview = () => {
    router.push(`/war-room?thread=${threadId}&review=1`);
    if (!summarizeJob || summarizeJob.status === "FAILED") startDraft();
  };

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

  // One live socket for whatever chat is on screen: the department room, or the case thread's own PartyKit room.
  const roomHandlers = useRoomCacheHandlers(roomId);
  const threadHandlers = useThreadCacheHandlers(threadId);
  const socket = useRoomSocket(
    threadId ? `case-${threadId}` : creating ? null : roomId,
    me,
    threadId ? threadHandlers : roomHandlers,
  );
  const live = socket.status === "live";
  useRoomPolling(roomId, room.isSuccess && !threadId, live);
  useThreadPolling(threadId, thread.isSuccess, live);
  const onlineIds = useMemo(() => new Set(socket.online.map((p) => p.id)), [socket.online]);

  // Reading the room moves the read marker to the newest confirmed message.
  const view = room.data;
  const newestSeq = view?.messages.reduce((max, m) => (m.pending ? max : Math.max(max, m.seq)), 0) ?? 0;
  const { mutate: markReadUpTo } = markRead;
  useEffect(() => {
    if (!threadId && view && newestSeq > view.last_read_seq && document.visibilityState === "visible") {
      markReadUpTo(newestSeq);
    }
  }, [threadId, view, newestSeq, markReadUpTo]);

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

  const goToRoom = (departmentId: string) => {
    if (departmentId !== roomId) selectRoom.mutate(departmentId);
    router.push("/war-room");
    setDrawer(null);
  };
  const goToThread = (caseId: string) => {
    router.push(`/war-room?thread=${caseId}`);
    setDrawer(null);
  };

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

  // A #CASE-… chip opens that case's thread when it's open, otherwise the vault.
  const handleCaseClick = (caseCode: string) => {
    const open = view?.threads.find((t) => t.case_code === caseCode);
    if (open) goToThread(open.id);
    else router.push("/vault");
  };

  const newMessage = (content: string, isMilestone: boolean) => ({
    input: { id: crypto.randomUUID(), content, is_milestone: isMilestone },
    author: me!,
  });

  const error =
    selectRoom.error ?? changeMember.error ?? pin.error ?? openArtifact.error ?? room.error ?? thread.error;
  const department = departments.data?.find((d) => d.id === roomId);

  const toggles = {
    roomsOpen: isOpen("rooms"),
    onToggleRooms: () => toggle("rooms"),
    contextOpen: isOpen("context"),
    onToggleContext: () => toggle("context"),
  };

  const alert = error && (
    <p role="alert" className="border-b border-destructive px-6 py-2 text-sm text-destructive">
      {error.message}
    </p>
  );

  let centre;
  if (!roomId) {
    centre = (
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
    );
  } else if (creating && department && departments.data) {
    centre = (
      <NewThreadForm
        key={department.id}
        department={department}
        departments={departments.data}
        people={people.data ?? []}
        currentUserId={user!.id}
        isSubmitting={createCase.isPending}
        error={createCase.error?.message}
        fieldErrors={createCase.error?.fieldErrors}
        onCancel={() => router.push("/war-room")}
        onSubmit={(values) =>
          createCase.mutate(
            { id: crypto.randomUUID(), department_id: department.id, ...values },
            { onSuccess: (created) => router.replace(`/war-room?thread=${created.id}`) },
          )
        }
      />
    );
  } else if (threadId && thread.data && reviewing) {
    const t = thread.data;
    const draft = summarizeJob?.status === "COMPLETED" ? summarizeJob.result : null;
    centre = (
      <>
        <ThreadBar
          roomCode={(department?.code ?? departmentCodes[t.department_id] ?? "").toLowerCase()}
          caseCode={t.case_code}
          title={`Resolve: ${t.title}`}
          severity={t.severity}
          clientName={t.client_name}
          departments={[t.department_id, ...t.secondary_department_ids].map((id) => departmentCodes[id] ?? id)}
          status={socket.status}
          onBack={() => router.push(`/war-room?thread=${t.id}`)}
          backLabel="Thread"
          {...toggles}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
          {t.status !== "OPEN" ? (
            <p className="text-sm text-muted-foreground">This case is already committed to memory.</p>
          ) : !summarizeJob ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                The AI summarizer reads this thread, the war-room messages that tag {t.case_code} and the case files,
                then drafts a Case Memory Record for you to review.
              </p>
              <Button onClick={startDraft} disabled={resolve.isPending}>
                {resolve.isPending ? "Starting…" : "Draft memory record"}
              </Button>
              {resolve.error && <p className="text-sm text-destructive">{resolve.error.message}</p>}
            </div>
          ) : draft?.record ? (
            <MemoryReviewForm
              key={summarizeJob.id}
              draft={draft.record}
              provider={draft.provider}
              guardWarnings={draft.guard_warnings}
              isCommitting={commitMemory.isPending}
              error={commitMemory.error?.message}
              onRegenerate={startDraft}
              onCommit={(record) =>
                commitMemory.mutate(record, { onSuccess: () => router.replace(`/war-room?thread=${t.id}`) })
              }
            />
          ) : (
            <div className="flex flex-col items-start gap-3">
              <JobProgress job={summarizeJob} title="Drafting the memory record" />
              {summarizeJob.status === "FAILED" && (
                <Button onClick={startDraft} disabled={resolve.isPending}>
                  Try again
                </Button>
              )}
              {resolve.error && <p className="text-sm text-destructive">{resolve.error.message}</p>}
            </div>
          )}
        </div>
      </>
    );
  } else if (threadId && thread.data) {
    const t = thread.data;
    const open = t.status === "OPEN";
    centre = (
      <>
        <ThreadBar
          roomCode={(department?.code ?? departmentCodes[t.department_id] ?? "").toLowerCase()}
          caseCode={t.case_code}
          title={t.title}
          severity={t.severity}
          clientName={t.client_name}
          departments={[t.department_id, ...t.secondary_department_ids].map((id) => departmentCodes[id] ?? id)}
          status={socket.status}
          onBack={() => router.push("/war-room")}
          onResolve={open ? openReview : undefined}
          {...toggles}
        />
        {alert}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {t.messages.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No messages yet. Kick off {t.case_code} with the team.
            </p>
          ) : (
            <MessageThread
              messages={t.messages}
              lastReadSeq={Infinity}
              currentUserId={user!.id}
              onOpenArtifact={handleOpenArtifact}
              onCaseClick={handleCaseClick}
            />
          )}
        </div>
        {open ? (
          <Composer
            roomName={t.case_code}
            onSend={(content, isMilestone) => me && sendThread.mutate(newMessage(content, isMilestone))}
            onTyping={socket.notifyTyping}
            typingNames={socket.typing.map((p) => p.name)}
            error={sendThread.error?.message}
          />
        ) : (
          <MemoryBanner summary={t.summary} resolvedAt={t.resolved_at} indexJob={jobs.data?.index ?? null} />
        )}
      </>
    );
  } else if (!threadId && view) {
    centre = (
      <>
        <PinnedCaseBar
          roomName={view.code.toLowerCase()}
          pinned={view.pinned_case}
          options={view.case_options}
          onPin={(caseId) => pin.mutate(caseId)}
          isPinning={pin.isPending}
          status={socket.status}
          otherUnread={otherUnread}
          {...toggles}
        />
        {alert}
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
          onSend={(content, isMilestone) => me && send.mutate(newMessage(content, isMilestone))}
          onTyping={socket.notifyTyping}
          typingNames={socket.typing.map((p) => p.name)}
          error={send.error?.message}
        />
      </>
    );
  } else {
    centre = error ? (
      alert
    ) : (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10" />
        <Skeleton className="h-64" />
      </div>
    );
  }

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
            onSelect={goToRoom}
            threads={view?.threads ?? []}
            activeThreadId={threadId}
            onSelectThread={goToThread}
            onNewThread={() => {
              router.push("/war-room?new=1");
              setDrawer(null);
            }}
            isCreatingThread={creating}
          />
        ) : (
          <Skeleton className="h-56" />
        )}
        {threadId && thread.data && me ? (
          <ParticipantList people={thread.data.participants} onlineIds={onlineIds} currentUserId={me.id} />
        ) : (
          view &&
          me && (
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
          )
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">{centre}</section>

      <aside aria-label="Case details and Dejavu context" className={cn(panelClass("context"), "bg-background")}>
        {threadId && thread.data ? (
          <>
            <div role="tablist" aria-label="Right panel" className="flex shrink-0 border-b">
              {(["details", "context"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={rightTab === tab}
                  onClick={() => setRightTab(tab)}
                  className={cn(
                    "micro-label relative flex-1 px-4 py-3 hover:bg-surface-2",
                    rightTab === tab
                      ? "text-navy after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-navy"
                      : "text-muted-foreground",
                  )}
                >
                  {tab === "details" ? "Case details" : "Dejavu context"}
                </button>
              ))}
            </div>
            {rightTab === "details" ? (
              <CaseDetailsPanel
                key={thread.data.id}
                thread={thread.data}
                departments={departments.data ?? []}
                people={people.data ?? []}
                onSave={(input) => updateCase.mutate(input)}
                isSaving={updateCase.isPending}
                error={updateCase.error?.message}
                fieldErrors={updateCase.error?.fieldErrors}
                onOpenFile={handleOpenArtifact}
              />
            ) : (
              <ContextPane pinned={thread.data} />
            )}
          </>
        ) : (
          <ContextPane pinned={view?.pinned_case ?? null} />
        )}
      </aside>
    </div>
  );
}
