"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  use,
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
import {
  OutcomeForm,
  type OutcomeUpload,
} from "@/components/memory/OutcomeForm";
import { AccessRequests } from "@/components/rooms/AccessRequests";
import { Composer, type Mentionable } from "@/components/rooms/Composer";
import { LockedChat } from "@/components/rooms/LockedChat";
import {
  MessageThread,
  type AgentStatus,
} from "@/components/rooms/MessageThread";
import { MemberList } from "@/components/rooms/MemberList";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CaseHeader } from "@/components/workspace/CaseHeader";
import { CopilotPanel } from "@/components/workspace/CopilotPanel";
import { PaneLayout } from "@/components/workspace/PaneLayout";
import { PrecedentDelta } from "@/components/workspace/PrecedentDelta";
import { ReusableKit } from "@/components/workspace/ReusableKit";
import { TabBar } from "@/components/workspace/TabBar";
import { TriageReportPanel } from "@/components/workspace/TriageReportPanel";
import { usePanels } from "@/lib/usePanels";
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
import { usePeople, useRoomSocket } from "@/store/rooms";
import {
  useChangeCaseMember,
  useDecideCaseAccess,
  useRequestCaseAccess,
  useOpenCases,
  useSendThreadMessage,
  useThread,
  useThreadCacheHandlers,
  useThreadPolling,
  useUpdateCase,
  useUploadFiles,
} from "@/store/threads";
import { useOpenArtifact } from "@/store/vault";
import type { OutcomeInput } from "@/types/memory";
import type { RoomPerson } from "@/types/rooms";

type Tab = "channel" | "delta" | "copilot" | "people";
const TABS: Tab[] = ["channel", "delta", "copilot", "people"];

export default function CasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = use(params);
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[60dvh] flex-1" />}>
      <CaseWorkspace caseId={caseId} />
    </Suspense>
  );
}

function CaseWorkspace({ caseId }: { caseId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get("tab")) ?? "channel";
  const reviewing = params.get("review") === "1";
  const base = `/workbench/cases/${caseId}`;

  const user = useSession().data?.user;
  const signedIn = Boolean(user);
  const departmentId = user?.active_department_id ?? null;

  const departments = useDepartments(signedIn);
  const people = usePeople(signedIn);
  const openCases = useOpenCases(departmentId, signedIn);
  const thread = useThread(signedIn ? caseId : null);
  const jobs = useCaseJobs(signedIn ? caseId : null);
  const member = thread.data?.is_member === true;
  const copilot = useCopilot(signedIn && member ? caseId : null);

  const analyze = useAnalyze();
  const updateCase = useUpdateCase(caseId);
  const uploadFiles = useUploadFiles();
  const sendThread = useSendThreadMessage(caseId);
  const askCopilot = useAskCopilot(caseId);
  const askInChannel = useAskCopilot(caseId);
  const [refused, setRefused] = useState<Record<string, string>>({});
  const resolve = useResolve(caseId);
  const commitMemory = useCommitMemory(caseId);
  const changeMember = useChangeCaseMember(caseId);
  const requestAccess = useRequestCaseAccess(caseId);
  const decideAccess = useDecideCaseAccess(caseId);
  const [askOutcome, setAskOutcome] = useState(false);
  const openArtifact = useOpenArtifact();
  const panels = usePanels();

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

  const handlers = useThreadCacheHandlers(caseId);
  const socket = useRoomSocket(member ? `case-${caseId}` : null, me, handlers);
  useThreadPolling(
    caseId,
    thread.isSuccess && member,
    socket.status === "live",
  );

  // When an analysis finishes, reload the case so the new matches and delta appear.
  const analysisJob = jobs.data?.analyze ?? null;
  const previousStatus = useRef<string | undefined>(undefined);
  const { refetch: refetchThread } = thread;
  const dejavuReplying = (copilot.data?.jobs ?? []).some(
    (j) => j.in_channel && (j.status === "QUEUED" || j.status === "PROCESSING"),
  );
  const wasReplying = useRef(false);
  useEffect(() => {
    if (wasReplying.current && !dejavuReplying) void refetchThread();
    wasReplying.current = dejavuReplying;
  }, [dejavuReplying, refetchThread]);
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

  const setTab = (next: Tab) => router.replace(`${base}?tab=${next}`);
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

  const t = thread.data;
  if (!t) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {thread.error ? (
          <p role="alert" className="p-6 text-sm text-destructive">
            {thread.error.message}
          </p>
        ) : (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-16" />
            <Skeleton className="h-72" />
          </div>
        )}
      </div>
    );
  }

  const isOpenCase = t.status === "OPEN";
  const isMember = t.is_member !== false;
  const canAct = isOpenCase && isMember;
  const pendingRequests = t.access_requests ?? [];
  const locked = (title: string, description: string) => (
    <LockedChat
      title={title}
      description={description}
      members={t.members.map((m) => m.user)}
      requested={Boolean(t.my_access_request)}
      onRequest={() => me && requestAccess.mutate(me)}
      isRequesting={requestAccess.isPending}
      error={requestAccess.error?.message}
    />
  );
  const top = t.precedents[0];
  const chips = [
    top && `Why did ${top.case_code} go the way it did?`,
    `Draft a reply to ${t.client_name ?? "the client"} with our plan`,
    top && `What's different from ${top.case_code}, and what's net-new?`,
  ].filter((c): c is string => Boolean(c));
  const usedFileIds = new Set(
    t.messages
      .map((m) => m.attached_artifact?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const summarizeJob = jobs.data?.summarize ?? null;
  const lastOutcome: OutcomeInput | null = summarizeJob?.result?.outcome
    ? {
        outcome: summarizeJob.result.outcome,
        final_output: summarizeJob.result.final_output ?? "",
        deliverable_file_ids: summarizeJob.result.deliverable_file_ids ?? [],
      }
    : null;
  const startDraft = async (
    input: OutcomeInput,
    uploads: OutcomeUpload[] = [],
  ) => {
    let uploaded: { id: string }[] = [];
    try {
      if (uploads.length)
        uploaded = await uploadFiles.mutateAsync({
          caseId,
          files: uploads.map((u) => u.file),
          fileTypes: uploads.map((u) => u.kind),
        });
    } catch {
      return;
    }
    resolve.mutate(
      {
        job_id: crypto.randomUUID(),
        ...input,
        deliverable_file_ids: [
          ...new Set([
            ...input.deliverable_file_ids,
            ...uploaded.map((f) => f.id),
          ]),
        ],
      },
      { onSuccess: () => setAskOutcome(false) },
    );
  };
  const openReview = () => router.push(`${base}?tab=${tab}&review=1`);
  const newMessage = (
    content: string,
    isMilestone: boolean,
    attached?: string,
    mentioned: string[] = [],
  ) => ({
    input: {
      id: crypto.randomUUID(),
      content,
      is_milestone: isMilestone,
      attached_artifact_id: attached,
      mentioned_user_ids: mentioned,
    },
    author: me!,
  });
  const sendToChannel = (
    content: string,
    isMilestone: boolean,
    mentioned: string[],
  ) => {
    if (!me) return;
    const message = newMessage(content, isMilestone, undefined, mentioned);
    sendThread.mutate(message, {
      onSuccess: () => {
        if (/@dejavu\b/i.test(content))
          askInChannel.mutate(
            {
              message_id: message.input.id,
              job_id: crypto.randomUUID(),
              question: content,
              reply_in_channel: true,
            },
            {
              onError: (error) =>
                setRefused((all) => ({
                  ...all,
                  [message.input.id]: `Not sent to Dejavu: ${error.message}`,
                })),
            },
          );
      },
    });
  };
  const channelJobs = (copilot.data?.jobs ?? [])
    .filter((j) => j.in_channel && j.asked_message_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const waiting = channelJobs.filter((j) => j.status === "QUEUED");
  const agentStatus: Record<string, AgentStatus> = Object.fromEntries(
    Object.entries(refused).map(([id, note]) => [
      id,
      { state: "limited", note },
    ]),
  );
  for (const job of channelJobs) {
    const position = waiting.indexOf(job);
    agentStatus[job.asked_message_id!] =
      job.status === "PROCESSING"
        ? { state: "answering", note: "Dejavu is answering…" }
        : job.status === "QUEUED"
          ? {
              state: "queued",
              note:
                position <= 0
                  ? "Queued · Dejavu will answer after the current question"
                  : `Queued · ${position + 1}${position === 1 ? "nd" : "rd"} in line`,
            }
          : { state: "failed", note: "Dejavu couldn't answer — ask again" };
  }
  const memberIds = new Set(t.members.map((m) => m.user.id));
  const mentionables: Mentionable[] = [
    {
      id: "dejavu",
      name: "Dejavu",
      initials: "AI",
      hint: "AI copilot · answers here in the channel",
      agent: true,
    },
    ...t.members
      .filter((m) => m.user.id !== me?.id)
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        initials: m.user.avatar_initials,
        hint: m.user.job_title ?? "Member",
      })),
    ...(people.data ?? [])
      .filter((p) => p.is_active && p.id !== me?.id && !memberIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        initials: p.avatar_initials,
        hint: "Not in this case yet · will be added",
      })),
  ];
  const mentionNames = (people.data ?? []).map((p) => p.name);

  const header = (
    <CaseHeader
      thread={t}
      status={socket.status}
      onComplete={canAct && !reviewing ? openReview : undefined}
      onBack={() => router.push("/workbench")}
      leftOpen={panels.isOpen("left")}
      onToggleLeft={() => panels.toggle("left")}
      rightOpen={panels.isOpen("right")}
      onToggleRight={() => panels.toggle("right")}
    />
  );

  let body: ReactNode;
  if (reviewing) {
    const draft =
      summarizeJob?.status === "COMPLETED" ? summarizeJob.result : null;
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Complete &amp; save to memory</SectionLabel>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`${base}?tab=${tab}`)}
          >
            Back to case
          </Button>
        </div>
        {!isOpenCase ? (
          <p className="text-sm text-muted-foreground">
            This case is already committed to the Knowledge Base.
          </p>
        ) : !summarizeJob || askOutcome ? (
          <div className="@container">
            <OutcomeForm
              clientName={t.client_name}
              files={t.artifacts}
              initial={lastOutcome ?? undefined}
              onSubmit={(input, uploads) => void startDraft(input, uploads)}
              isSubmitting={resolve.isPending || uploadFiles.isPending}
              submitLabel={
                uploadFiles.isPending ? "Uploading files…" : undefined
              }
            />
          </div>
        ) : draft?.record ? (
          <MemoryReviewForm
            key={summarizeJob.id}
            draft={draft.record}
            provider={draft.provider ?? ""}
            guardWarnings={draft.guard_warnings ?? []}
            outcome={draft.outcome ?? "RESOLVED"}
            finalOutput={draft.final_output ?? ""}
            files={t.artifacts}
            curator={draft.curator}
            onCaseClick={handleCaseClick}
            isCommitting={commitMemory.isPending}
            error={commitMemory.error?.message}
            onRegenerate={() =>
              lastOutcome ? startDraft(lastOutcome) : setAskOutcome(true)
            }
            onChangeOutcome={() => setAskOutcome(true)}
            onCommit={(input) =>
              commitMemory.mutate(input, {
                onSuccess: () => router.replace(`${base}?tab=channel`),
              })
            }
          />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Dejavu is reading the case chat, the department mentions and the
              files with your outcome, drafting the memory record, then picking
              reusable files and checking the lessons against older cases.
            </p>
            <JobProgress job={summarizeJob} title="Memory curator" />
            {summarizeJob.status === "FAILED" && (
              <Button
                onClick={() => setAskOutcome(true)}
                disabled={resolve.isPending}
              >
                Try again
              </Button>
            )}
          </div>
        )}
        {(resolve.error ?? uploadFiles.error) && (
          <p className="text-sm text-destructive">
            {(resolve.error ?? uploadFiles.error)?.message}
          </p>
        )}
      </div>
    );
  } else {
    const copilotMessages = copilot.data?.messages ?? [];
    const copilotJobs = (copilot.data?.jobs ?? []).filter((j) => !j.in_channel);
    const copilotThinking = copilotJobs.some(
      (j) => j.status === "QUEUED" || j.status === "PROCESSING",
    );
    body = (
      <>
        <TabBar
          label="Case views"
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: "channel", label: `Case channel (${t.messages.length})` },
            {
              id: "delta",
              label: `Precedent & delta (${t.precedents.length})`,
            },
            {
              id: "copilot",
              label: `Memory copilot${copilotThinking ? " · thinking" : ""}`,
            },
            {
              id: "people",
              label: `People (${t.members.length})${pendingRequests.length ? ` · ${pendingRequests.length} asking` : ""}`,
            },
          ]}
        />
        {tab === "channel" &&
          !isMember &&
          locked(
            "This case channel is members-only",
            "You can see the case, its precedents and reusable kit. The team's conversation is visible to members of the case.",
          )}
        {tab === "channel" && isMember && (
          <>
            {top && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface-2 px-6 py-2 text-xs text-muted-foreground">
                <span className="micro-label text-navy">Dejavu</span>
                Closest precedent:{" "}
                <span className="font-medium text-ink">{top.case_code}</span> (
                {top.similarity_score}
                %)
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
                  currentUserName={user!.name}
                  agentStatus={agentStatus}
                  mentionNames={mentionNames}
                  onOpenArtifact={handleOpenArtifact}
                  onCaseClick={handleCaseClick}
                />
              )}
            </div>
            {isOpenCase ? (
              <Composer
                roomName={t.channel_slug}
                onSend={sendToChannel}
                onTyping={socket.notifyTyping}
                typingNames={[
                  ...(dejavuReplying ? ["Dejavu"] : []),
                  ...socket.typing.map((p) => p.name),
                ]}
                mentionables={mentionables}
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
        )}
        {tab === "delta" && (
          <div className="@container min-h-0 flex-1 overflow-y-auto">
            <PrecedentDelta
              key={t.id}
              precedents={t.precedents}
              departmentCodes={departmentCodes}
              analysis={analysisJob}
              onRunAnalysis={
                canAct
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
              header={
                t.triage_report ? (
                  <TriageReportPanel
                    report={t.triage_report}
                    trace={analysisJob?.trace ?? []}
                    departmentCodes={departmentCodes}
                    memberIds={memberIds}
                    canAct={canAct}
                    onCaseClick={handleCaseClick}
                    onAddMember={(userId) => {
                      const person = people.data?.find((p) => p.id === userId);
                      if (person) changeMember.mutate({ kind: "add", person });
                    }}
                    onPostQuestions={(text) => {
                      if (!me) return;
                      sendThread.mutate(newMessage(text, false));
                      setTab("channel");
                    }}
                  />
                ) : undefined
              }
            />
          </div>
        )}
        {tab === "people" && me && (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="flex max-w-xl flex-col gap-4">
              {isMember && (
                <AccessRequests
                  requests={pendingRequests}
                  departmentCodes={departmentCodes}
                  onDecide={(requestId, approve) =>
                    decideAccess.mutate({ requestId, approve })
                  }
                />
              )}
              {!isMember && (
                <p className="text-xs text-muted-foreground">
                  Only members can add people.{" "}
                  {t.my_access_request
                    ? "Your request to join is waiting for a member."
                    : "Ask to join from the Case channel tab."}
                </p>
              )}
              <MemberList
                noun="case"
                readOnly={!canAct}
                members={t.members}
                people={people.data ?? []}
                currentUserId={me.id}
                isMember={t.members.some((m) => m.user.id === me.id)}
                departmentCodes={departmentCodes}
                onlineIds={new Set(socket.online.map((p) => p.id))}
                onAdd={(person) => changeMember.mutate({ kind: "add", person })}
                onRemove={(userId) =>
                  changeMember.mutate({ kind: "remove", userId })
                }
              />
              {changeMember.error && (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  {changeMember.error.message}
                </p>
              )}
            </div>
          </div>
        )}
        {tab === "copilot" &&
          !isMember &&
          locked(
            "Memory copilot is members-only here",
            "It reads this case's private channel to answer, so it's available to members of the case.",
          )}
        {tab === "copilot" && isMember && (
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
        )}
      </>
    );
  }

  return (
    <PaneLayout
      id="dejavu-case"
      panels={panels}
      left={{
        label: "Case details",
        defaultSize: "26",
        content: (
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
            canEdit={isMember}
          />
        ),
      }}
      right={{
        label: "Reusable kit",
        content: (
          <div className="p-5">
            <ReusableKit
              precedents={t.precedents}
              ownFiles={t.artifacts}
              usedFileIds={usedFileIds}
              canUse={canAct}
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
        ),
      }}
    >
      {header}
      {body}
    </PaneLayout>
  );
}
