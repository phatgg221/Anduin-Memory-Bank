"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useDefaultLayout,
  usePanelRef,
  type LayoutStorage,
} from "react-resizable-panels";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { CaseDetailsPanel } from "@/components/cases/CaseDetailsPanel";
import { JobProgress } from "@/components/memory/JobProgress";
import { MemoryBanner } from "@/components/memory/MemoryBanner";
import { MemoryReviewForm } from "@/components/memory/MemoryReviewForm";
import { Composer } from "@/components/rooms/Composer";
import { MemberList } from "@/components/rooms/MemberList";
import { MessageThread } from "@/components/rooms/MessageThread";
import { PanelToggle } from "@/components/rooms/PanelToggle";
import { SystemStatus } from "@/components/system/SystemStatus";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { CaseHeader } from "@/components/workspace/CaseHeader";
import { CaseRoomList } from "@/components/workspace/CaseRoomList";
import { CopilotPanel } from "@/components/workspace/CopilotPanel";
import { EmptyWorkspace } from "@/components/workspace/EmptyWorkspace";
import {
  IntakePanel,
  type IntakeSubmission,
} from "@/components/workspace/IntakePanel";
import { PrecedentDelta } from "@/components/workspace/PrecedentDelta";
import { ReusableKit } from "@/components/workspace/ReusableKit";
import { DEMO_SCENARIOS } from "@/lib/demoScenarios";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useSession } from "@/store/auth";
import {
  useAnalyze,
  useAskCopilot,
  useCaseJobs,
  useCommitMemory,
  useCopilot,
  useResolve,
} from "@/store/memory";
import { useDepartments } from "@/store/org";
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
} from "@/store/rooms";
import {
  useCreateCase,
  useOpenCases,
  useSendThreadMessage,
  useThread,
  useThreadCacheHandlers,
  useThreadPolling,
  useUpdateCase,
  useUploadFiles,
} from "@/store/threads";
import { useSystemHealth } from "@/store/system";
import { useOpenArtifact } from "@/store/vault";
import type { RoomPerson } from "@/types/rooms";

type Panel = "left" | "right";

const layoutStorage: LayoutStorage = {
  getItem: (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
type Tab = "channel" | "delta" | "details" | "copilot";

// useSearchParams needs a Suspense boundary under Cache Components.
export default function WorkbenchPage() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[60dvh]" />}>
      <Workbench />
    </Suspense>
  );
}

/**
 * Case Workspace: 01 intake + active case rooms · 02 precedent delta / case channel / details · 03 reusable kit +
 * memory copilot. The URL holds the selection: ?case=<id>&tab=channel|delta|details|copilot[&review=1], or ?room=1 for the
 * department's general room.
 */
function Workbench() {
  const router = useRouter();
  const params = useSearchParams();
  const caseId = params.get("case");
  const roomMode = !caseId && params.get("room") === "1";
  const tab: Tab =
    (["channel", "delta", "details", "copilot"] as const).find(
      (t) => t === params.get("tab"),
    ) ?? "channel";
  const reviewing = Boolean(caseId) && params.get("review") === "1";

  const user = useSession().data?.user;
  const signedIn = Boolean(user);
  const departmentId = user?.active_department_id ?? null;

  const departments = useDepartments(signedIn);
  const people = usePeople(signedIn);
  const openCases = useOpenCases(departmentId, signedIn);
  const rooms = useRooms(signedIn);
  const thread = useThread(signedIn ? caseId : null);
  const room = useRoom(signedIn && roomMode ? departmentId : null);
  const jobs = useCaseJobs(signedIn ? caseId : null);
  const copilot = useCopilot(signedIn ? caseId : null);

  const createCase = useCreateCase();
  const upload = useUploadFiles();
  const analyze = useAnalyze();
  const updateCase = useUpdateCase(caseId ?? "");
  const sendThread = useSendThreadMessage(caseId ?? "");
  const sendRoom = useSendMessage(departmentId ?? "");
  const markRead = useMarkRead(departmentId ?? "");
  const changeMember = useChangeMember(departmentId ?? "");
  const askCopilot = useAskCopilot(caseId ?? "");
  const resolve = useResolve(caseId ?? "");
  const commitMemory = useCommitMemory(caseId ?? "");
  const openArtifact = useOpenArtifact();

  const departmentCodes = useMemo(
    () =>
      Object.fromEntries((departments.data ?? []).map((d) => [d.id, d.code])),
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

  // One live socket for the chat on screen: the case's PartyKit room, or the department room.
  const threadHandlers = useThreadCacheHandlers(caseId);
  const roomHandlers = useRoomCacheHandlers(departmentId);
  const socket = useRoomSocket(
    caseId ? `case-${caseId}` : roomMode ? departmentId : null,
    me,
    caseId ? threadHandlers : roomHandlers,
  );
  const live = socket.status === "live";
  useThreadPolling(caseId, thread.isSuccess, live);
  useRoomPolling(departmentId, roomMode && room.isSuccess, live);

  // When an analysis finishes, reload the case so the new matches and delta appear.
  const analysisJob = jobs.data?.analyze ?? null;
  const previousStatus = useRef<string | undefined>(undefined);
  const { refetch: refetchThread } = thread;
  useEffect(() => {
    const status = analysisJob?.status;
    if (
      previousStatus.current &&
      previousStatus.current !== "COMPLETED" &&
      status === "COMPLETED"
    )
      void refetchThread();
    previousStatus.current = status;
  }, [analysisJob?.status, refetchThread]);

  // Reading the department room moves its read marker.
  const roomView = room.data;
  const newestRoomSeq =
    roomView?.messages.reduce(
      (max, m) => (m.pending ? max : Math.max(max, m.seq)),
      0,
    ) ?? 0;
  const { mutate: markReadUpTo } = markRead;
  useEffect(() => {
    if (roomMode && roomView && newestRoomSeq > roomView.last_read_seq)
      markReadUpTo(newestRoomSeq);
  }, [roomMode, roomView, newestRoomSeq, markReadUpTo]);

  // Panels: columns on wide screens (collapsible), drawers on narrow ones. The centre always stays.
  const isWide = useMediaQuery("(min-width: 1024px)", false);
  const [wideOpen, setWideOpen] = useState<Record<Panel, boolean>>({
    left: true,
    right: true,
  });
  const [drawer, setDrawer] = useState<Panel | null>(null);
  const isOpen = (panel: Panel) =>
    isWide ? wideOpen[panel] : drawer === panel;
  const panelRefs = { left: usePanelRef(), right: usePanelRef() };
  const toggle = (panel: Panel) => {
    if (!isWide)
      return setDrawer((current) => (current === panel ? null : panel));
    const ref = panelRefs[panel].current;
    if (ref?.isCollapsed()) ref.expand();
    else ref?.collapse();
  };
  const syncOpen = (panel: Panel, pixels: number) =>
    setWideOpen((open) =>
      open[panel] === pixels > 0 ? open : { ...open, [panel]: pixels > 0 },
    );
  const workspaceLayout = useDefaultLayout({
    id: "dejavu-workspace",
    storage: layoutStorage,
  });
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && setDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  const drawerClass = (panel: Panel) =>
    cn(
      "fixed top-14 bottom-0 z-30 w-[min(360px,90vw)] flex-col overflow-y-auto bg-surface-2",
      drawer === panel ? "flex" : "hidden",
      panel === "left" ? "left-0 border-r" : "right-0 border-l",
    );

  const go = (query: string) => {
    router.push(`/workbench${query}`);
    setDrawer(null);
  };
  const openCase = (id: string, nextTab: Tab = "channel") =>
    go(`?case=${id}&tab=${nextTab}`);
  const setTab = (next: Tab) =>
    router.replace(`/workbench?case=${caseId}&tab=${next}`);

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
  const handleCaseClick = (code: string) => {
    const open = openCases.data?.find((c) => c.case_code === code);
    if (open) openCase(open.id);
    else router.push("/vault");
  };

  // Intake → case → files → analysis → open the room on the delta tab.
  const [runStage, setRunStage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | undefined>();
  const runIntake = async ({
    intake,
    files,
    departmentId: scenarioDepartment,
  }: IntakeSubmission) => {
    if (!me) return;
    setRunError(undefined);
    const owner =
      scenarioDepartment ??
      departmentId ??
      user?.primary_department_id ??
      "CLIENT_OPERATIONS";
    try {
      setRunStage("Opening the case room…");
      const created = await createCase.mutateAsync({
        id: crypto.randomUUID(),
        department_id: owner,
        lead_user_id: me.id,
        ...intake,
      });
      if (files.length) {
        setRunStage(
          `Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`,
        );
        await upload.mutateAsync({ caseId: created.id, files });
      }
      setRunStage("Starting the analysis…");
      await analyze.mutateAsync({
        caseId: created.id,
        jobId: crypto.randomUUID(),
      });
      openCase(created.id, "delta");
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Couldn't open the case room.",
      );
    } finally {
      setRunStage(null);
    }
  };

  const t = thread.data;
  const isOpenCase = t?.status === "OPEN";
  const top = t?.precedents[0];
  const chips = t
    ? [
        top && `Why did ${top.case_code} go the way it did?`,
        `Draft a reply to ${t.client_name ?? "the client"} with our plan`,
        top && `What's different from ${top.case_code}, and what's net-new?`,
      ].filter((c): c is string => Boolean(c))
    : [];
  const usedFileIds = new Set(
    (t?.messages ?? [])
      .map((m) => m.attached_artifact?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const fundSuggestions = [
    ...new Set(
      (openCases.data ?? [])
        .map((c) => c.fund_name)
        .filter((f): f is string => Boolean(f)),
    ),
  ];
  const departmentRoom = rooms.data?.find(
    (r) => r.department_id === departmentId,
  );
  const summarizeJob = jobs.data?.summarize ?? null;

  const startDraft = () => resolve.mutate(crypto.randomUUID());
  const openReview = () => {
    router.push(`/workbench?case=${caseId}&tab=${tab}&review=1`);
    if (!summarizeJob || summarizeJob.status === "FAILED") startDraft();
  };
  const newMessage = (
    content: string,
    isMilestone: boolean,
    attached?: string,
  ) => ({
    input: {
      id: crypto.randomUUID(),
      content,
      is_milestone: isMilestone,
      attached_artifact_id: attached,
    },
    author: me!,
  });

  // ---------- centre pane ----------
  let centre: ReactNode;
  if (caseId && !t) {
    centre = thread.error ? (
      <p role="alert" className="p-6 text-sm text-destructive">
        {thread.error.message}
      </p>
    ) : (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-72" />
      </div>
    );
  } else if (t) {
    const header = (
      <CaseHeader
        thread={t}
        status={socket.status}
        onComplete={isOpenCase && !reviewing ? openReview : undefined}
        leftOpen={isOpen("left")}
        onToggleLeft={() => toggle("left")}
        rightOpen={isOpen("right")}
        onToggleRight={() => toggle("right")}
      />
    );
    if (reviewing) {
      const draft =
        summarizeJob?.status === "COMPLETED" ? summarizeJob.result : null;
      centre = (
        <>
          {header}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Complete &amp; save to memory</SectionLabel>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  router.push(`/workbench?case=${t.id}&tab=${tab}`)
                }
              >
                Back to case
              </Button>
            </div>
            {!isOpenCase ? (
              <p className="text-sm text-muted-foreground">
                This case is already committed to memory.
              </p>
            ) : draft?.record && summarizeJob ? (
              <MemoryReviewForm
                key={summarizeJob.id}
                draft={draft.record}
                provider={draft.provider ?? ""}
                guardWarnings={draft.guard_warnings ?? []}
                isCommitting={commitMemory.isPending}
                error={commitMemory.error?.message}
                onRegenerate={startDraft}
                onCommit={(record) =>
                  commitMemory.mutate(record, {
                    onSuccess: () =>
                      router.replace(`/workbench?case=${t.id}&tab=channel`),
                  })
                }
              />
            ) : summarizeJob ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  The AI summarizer is reading the case channel, the war-room
                  mentions and the files, and drafting the memory record (how it
                  went, resolution steps, pitfalls) for your review.
                </p>
                <JobProgress
                  job={summarizeJob}
                  title="Drafting the memory record"
                />
                {summarizeJob.status === "FAILED" && (
                  <Button onClick={startDraft} disabled={resolve.isPending}>
                    Try again
                  </Button>
                )}
              </div>
            ) : (
              <Button
                className="w-fit"
                onClick={startDraft}
                disabled={resolve.isPending}
              >
                Draft memory record
              </Button>
            )}
            {resolve.error && (
              <p className="text-sm text-destructive">
                {resolve.error.message}
              </p>
            )}
          </div>
        </>
      );
    } else {
      const deltaView = (
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <PrecedentDelta
            key={t.id}
            precedents={t.precedents}
            departmentCodes={departmentCodes}
            analysis={analysisJob}
            onRunAnalysis={
              isOpenCase
                ? () =>
                    analyze.mutate({
                      caseId: t.id,
                      jobId: crypto.randomUUID(),
                    })
                : undefined
            }
            isStarting={analyze.isPending}
            onOpenFile={handleOpenArtifact}
            onOpenVault={() => router.push("/vault")}
            onOpenChannel={() => setTab("channel")}
          />
        </div>
      );
      const channelView = (
        <>
          {top && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface-2 px-6 py-2 text-xs text-muted-foreground">
              <span className="micro-label text-navy">Dejavu</span>
              Closest precedent:{" "}
              <span className="font-medium text-ink">{top.case_code}</span> (
              {top.similarity_score}%)
              {top.lead_is_alumni &&
                top.lead_name &&
                ` · led by ${top.lead_name} (alumni)`}
            </div>
          )}
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
          {isOpenCase ? (
            <Composer
              roomName={t.channel_slug}
              onSend={(content, isMilestone) =>
                me && sendThread.mutate(newMessage(content, isMilestone))
              }
              onTyping={socket.notifyTyping}
              typingNames={socket.typing.map((p) => p.name)}
              error={sendThread.error?.message}
            />
          ) : (
            <MemoryBanner
              summary={t.summary}
              resolvedAt={t.resolved_at}
              indexJob={jobs.data?.index ?? null}
            />
          )}
        </>
      );
      const detailsView = (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-3xl">
            <CaseDetailsPanel
              key={t.id}
              thread={t}
              departments={departments.data ?? []}
              people={people.data ?? []}
              onSave={(input) => updateCase.mutate(input)}
              isSaving={updateCase.isPending}
              error={updateCase.error?.message}
              fieldErrors={updateCase.error?.fieldErrors}
              onOpenFile={handleOpenArtifact}
            />
          </div>
        </div>
      );
      const deltaTab = {
        id: "delta" as const,
        label: `Precedent & delta (${t.precedents.length})`,
      };
      const channelTab = {
        id: "channel" as const,
        label: `Case channel (${t.messages.length})`,
      };
      const detailsTab = { id: "details" as const, label: "Details" };
      const copilotMessages = copilot.data?.messages ?? [];
      const copilotJobs = copilot.data?.jobs ?? [];
      const copilotThinking = copilotJobs.some(
        (j) => j.status === "QUEUED" || j.status === "PROCESSING",
      );
      const copilotTab = {
        id: "copilot" as const,
        label: `Memory copilot${copilotThinking ? " · thinking" : ""}`,
      };
      const copilotView = (
        <div className="flex min-h-0 flex-1 flex-col p-6">
          <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col">
            <CopilotPanel
              messages={copilotMessages}
              jobs={copilotJobs}
              chips={chips}
              error={askCopilot.error?.message ?? copilot.error?.message}
              onCaseClick={handleCaseClick}
              onAsk={(question) =>
                askCopilot.mutate({
                  message_id: crypto.randomUUID(),
                  job_id: crypto.randomUUID(),
                  question,
                })
              }
            />
          </div>
        </div>
      );

      centre = (
        <>
          {header}
          <TabBar
            tabs={[channelTab, deltaTab, detailsTab, copilotTab]}
            active={tab}
            onSelect={setTab}
          />
          {tab === "delta" && deltaView}
          {tab === "channel" && channelView}
          {tab === "details" && detailsView}
          {tab === "copilot" && copilotView}
        </>
      );
    }
  } else if (roomMode && roomView) {
    centre = (
      <>
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <PanelToggle
            label="Toggle intake and rooms"
            pressed={isOpen("left")}
            onClick={() => toggle("left")}
          >
            <PanelLeft className="size-4" />
          </PanelToggle>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="micro-label text-navy">
              02 / # {roomView.code.toLowerCase()} · department room
            </span>
            <span className="truncate text-sm text-ink">
              {roomView.name}: general discussion and triage
            </span>
          </div>
          <PanelToggle
            label="Toggle members"
            pressed={isOpen("right")}
            onClick={() => toggle("right")}
          >
            <PanelRight className="size-4" />
          </PanelToggle>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageThread
            messages={roomView.messages}
            lastReadSeq={roomView.last_read_seq}
            currentUserId={user!.id}
            onOpenArtifact={handleOpenArtifact}
            onCaseClick={handleCaseClick}
          />
        </div>
        <Composer
          roomName={roomView.code.toLowerCase()}
          onSend={(content, isMilestone) =>
            me && sendRoom.mutate(newMessage(content, isMilestone))
          }
          onTyping={socket.notifyTyping}
          typingNames={socket.typing.map((p) => p.name)}
          error={sendRoom.error?.message}
        />
      </>
    );
  } else {
    centre = (
      <>
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <PanelToggle
            label="Toggle intake and rooms"
            pressed={isOpen("left")}
            onClick={() => toggle("left")}
          >
            <PanelLeft className="size-4" />
          </PanelToggle>
          <SectionLabel index={2}>Precedent delta &amp; case room</SectionLabel>
          <span className="size-8" />
        </div>
        <EmptyWorkspace
          rooms={openCases.data ?? []}
          onOpen={(id) => openCase(id)}
        />
      </>
    );
  }

  // ---------- right pane ----------
  let right: ReactNode;
  if (t && !reviewing) {
    right = (
      <div className="p-5">
        <ReusableKit
          precedents={t.precedents}
          ownFiles={t.artifacts}
          usedFileIds={usedFileIds}
          canUse={isOpenCase}
          onPreview={handleOpenArtifact}
          onUse={(file) => {
            sendThread.mutate(
              newMessage(
                `Reusing ${file.name} from ${file.caseCode}.`,
                false,
                file.id,
              ),
            );
            setTab("channel");
          }}
        />
      </div>
    );
  } else if (roomMode && roomView && me) {
    right = (
      <div className="p-5">
        <MemberList
          members={roomView.members}
          people={people.data ?? []}
          currentUserId={me.id}
          isMember={roomView.is_member}
          departmentCodes={departmentCodes}
          onlineIds={new Set(socket.online.map((p) => p.id))}
          onAdd={(person) => changeMember.mutate({ kind: "add", person })}
          onRemove={(userId) => changeMember.mutate({ kind: "remove", userId })}
        />
      </div>
    );
  } else {
    right = (
      <div className="flex flex-col gap-3 p-5">
        <SectionLabel index={3}>Reusable kit</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Open a case to see the deliverables rescued from its matched past
          cases.
        </p>
      </div>
    );
  }

  const leftBody = (
    <div className="flex flex-col gap-6 p-5">
      <IntakePanel
        scenarios={DEMO_SCENARIOS}
        fundSuggestions={fundSuggestions}
        onRun={runIntake}
        isRunning={runStage !== null}
        runLabel={runStage ?? undefined}
        error={runError}
      />
      <div className="border-t" />
      {openCases.data ? (
        <CaseRoomList
          rooms={openCases.data}
          activeCaseId={caseId}
          departmentCodes={departmentCodes}
          onSelect={(id) => openCase(id, tab)}
          departmentRoom={
            departmentRoom
              ? {
                  code: departmentRoom.code,
                  unread: departmentRoom.unread_count,
                }
              : null
          }
          departmentRoomActive={roomMode}
          onSelectDepartmentRoom={() => go("?room=1")}
        />
      ) : (
        <Skeleton className="h-48" />
      )}
    </div>
  );
  const leftLabel = "Intake and active case rooms";
  const rightLabel = "Reusable kit";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="relative flex min-h-0 flex-1">
        {isWide ? (
          <ResizablePanelGroup
            orientation="horizontal"
            id="dejavu-workspace"
            defaultLayout={workspaceLayout.defaultLayout}
            onLayoutChanged={workspaceLayout.onLayoutChanged}
          >
            <ResizablePanel
              id="left"
              panelRef={panelRefs.left}
              defaultSize="22"
              minSize={260}
              maxSize="40"
              collapsible
              collapsedSize={0}
              onResize={(size) => syncOpen("left", size.inPixels)}
            >
              <aside
                aria-label={leftLabel}
                className="h-full overflow-y-auto bg-surface-2"
              >
                {leftBody}
              </aside>
            </ResizablePanel>
            <SplitHandle />
            <ResizablePanel id="centre" minSize="30">
              <section className="flex h-full min-h-0 min-w-0 flex-col">
                {centre}
              </section>
            </ResizablePanel>
            <SplitHandle />
            <ResizablePanel
              id="right"
              panelRef={panelRefs.right}
              defaultSize="22"
              minSize={260}
              maxSize="40"
              collapsible
              collapsedSize={0}
              onResize={(size) => syncOpen("right", size.inPixels)}
            >
              <aside
                aria-label={rightLabel}
                className="h-full overflow-y-auto bg-surface-2"
              >
                {right}
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <>
            {drawer && (
              <button
                type="button"
                aria-label="Close panel"
                onClick={() => setDrawer(null)}
                className="fixed inset-x-0 top-14 bottom-0 z-20 bg-navy/20"
              />
            )}
            <aside aria-label={leftLabel} className={drawerClass("left")}>
              {leftBody}
            </aside>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              {centre}
            </section>
            <aside aria-label={rightLabel} className={drawerClass("right")}>
              {right}
            </aside>
          </>
        )}
      </div>
      <SystemStatusBar />
    </div>
  );
}

function SplitHandle() {
  return (
    <ResizableHandle
      withHandle
      className="transition-colors hover:bg-brand-cyan data-[separator=active]:bg-brand-cyan"
    />
  );
}

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: Tab; label: string }[];
  active: Tab;
  onSelect?: (tab: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Case views"
      className="flex shrink-0 overflow-x-auto border-b"
    >
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onSelect?.(item.id)}
          className={cn(
            "micro-label relative flex shrink-0 items-center gap-2 border-r px-4 py-3 hover:bg-surface-2",
            active === item.id
              ? "text-navy after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-navy"
              : "text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5",
              active === item.id ? "bg-navy" : "bg-hairline",
            )}
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SystemStatusBar() {
  const health = useSystemHealth();
  return (
    <SystemStatus
      health={health.data}
      isLoading={health.isPending}
      isError={health.isError}
    />
  );
}
