"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useRef, type ReactNode } from "react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { CaseDetailsPanel } from "@/components/cases/CaseDetailsPanel";
import { JobProgress } from "@/components/memory/JobProgress";
import { MemoryBanner } from "@/components/memory/MemoryBanner";
import { MemoryReviewForm } from "@/components/memory/MemoryReviewForm";
import { Composer } from "@/components/rooms/Composer";
import { MemberList } from "@/components/rooms/MemberList";
import { MessageThread } from "@/components/rooms/MessageThread";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CaseHeader } from "@/components/workspace/CaseHeader";
import { CopilotPanel } from "@/components/workspace/CopilotPanel";
import { PaneLayout } from "@/components/workspace/PaneLayout";
import { PrecedentDelta } from "@/components/workspace/PrecedentDelta";
import { ReusableKit } from "@/components/workspace/ReusableKit";
import { TabBar } from "@/components/workspace/TabBar";
import { usePanels } from "@/lib/usePanels";
import { useSession } from "@/store/auth";
import { useAnalyze, useAskCopilot, useCaseJobs, useCommitMemory, useCopilot, useResolve } from "@/store/memory";
import { useDepartments } from "@/store/org";
import { usePeople, useRoomSocket } from "@/store/rooms";
import {
  useChangeCaseMember,
  useOpenCases,
  useSendThreadMessage,
  useThread,
  useThreadCacheHandlers,
  useThreadPolling,
  useUpdateCase,
} from "@/store/threads";
import { useOpenArtifact } from "@/store/vault";
import type { RoomPerson } from "@/types/rooms";

type Tab = "channel" | "delta" | "copilot" | "people";
const TABS: Tab[] = ["channel", "delta", "copilot", "people"];

export default function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
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
  const copilot = useCopilot(signedIn ? caseId : null);

  const analyze = useAnalyze();
  const updateCase = useUpdateCase(caseId);
  const sendThread = useSendThreadMessage(caseId);
  const askCopilot = useAskCopilot(caseId);
  const resolve = useResolve(caseId);
  const commitMemory = useCommitMemory(caseId);
  const changeMember = useChangeCaseMember(caseId);
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

  const handlers = useThreadCacheHandlers(caseId);
  const socket = useRoomSocket(`case-${caseId}`, me, handlers);
  useThreadPolling(caseId, thread.isSuccess, socket.status === "live");

  // When an analysis finishes, reload the case so the new matches and delta appear.
  const analysisJob = jobs.data?.analyze ?? null;
  const previousStatus = useRef<string | undefined>(undefined);
  const { refetch: refetchThread } = thread;
  useEffect(() => {
    const status = analysisJob?.status;
    if (previousStatus.current && previousStatus.current !== "COMPLETED" && status === "COMPLETED") void refetchThread();
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
  const top = t.precedents[0];
  const chips = [
    top && `Why did ${top.case_code} go the way it did?`,
    `Draft a reply to ${t.client_name ?? "the client"} with our plan`,
    top && `What's different from ${top.case_code}, and what's net-new?`,
  ].filter((c): c is string => Boolean(c));
  const usedFileIds = new Set(
    t.messages.map((m) => m.attached_artifact?.id).filter((id): id is string => Boolean(id)),
  );
  const summarizeJob = jobs.data?.summarize ?? null;
  const startDraft = () => resolve.mutate(crypto.randomUUID());
  const openReview = () => {
    router.push(`${base}?tab=${tab}&review=1`);
    if (!summarizeJob || summarizeJob.status === "FAILED") startDraft();
  };
  const newMessage = (content: string, isMilestone: boolean, attached?: string) => ({
    input: { id: crypto.randomUUID(), content, is_milestone: isMilestone, attached_artifact_id: attached },
    author: me!,
  });

  const header = (
    <CaseHeader
      thread={t}
      status={socket.status}
      onComplete={isOpenCase && !reviewing ? openReview : undefined}
      onBack={() => router.push("/workbench")}
      leftOpen={panels.isOpen("left")}
      onToggleLeft={() => panels.toggle("left")}
      rightOpen={panels.isOpen("right")}
      onToggleRight={() => panels.toggle("right")}
    />
  );

  let body: ReactNode;
  if (reviewing) {
    const draft = summarizeJob?.status === "COMPLETED" ? summarizeJob.result : null;
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Complete &amp; save to memory</SectionLabel>
          <Button variant="ghost" size="sm" onClick={() => router.push(`${base}?tab=${tab}`)}>
            Back to case
          </Button>
        </div>
        {!isOpenCase ? (
          <p className="text-sm text-muted-foreground">This case is already committed to memory.</p>
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
              commitMemory.mutate(record, { onSuccess: () => router.replace(`${base}?tab=channel`) })
            }
          />
        ) : summarizeJob ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              The AI summarizer is reading the case channel, the war-room mentions and the files, and drafting the
              memory record (how it went, resolution steps, pitfalls) for your review.
            </p>
            <JobProgress job={summarizeJob} title="Drafting the memory record" />
            {summarizeJob.status === "FAILED" && (
              <Button onClick={startDraft} disabled={resolve.isPending}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <Button className="w-fit" onClick={startDraft} disabled={resolve.isPending}>
            Draft memory record
          </Button>
        )}
        {resolve.error && <p className="text-sm text-destructive">{resolve.error.message}</p>}
      </div>
    );
  } else {
    const copilotMessages = copilot.data?.messages ?? [];
    const copilotJobs = copilot.data?.jobs ?? [];
    const copilotThinking = copilotJobs.some((j) => j.status === "QUEUED" || j.status === "PROCESSING");
    body = (
      <>
        <TabBar
          label="Case views"
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: "channel", label: `Case channel (${t.messages.length})` },
            { id: "delta", label: `Precedent & delta (${t.precedents.length})` },
            { id: "copilot", label: `Memory copilot${copilotThinking ? " · thinking" : ""}` },
            { id: "people", label: `People (${t.members.length})` },
          ]}
        />
        {tab === "channel" && (
          <>
            {top && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface-2 px-6 py-2 text-xs text-muted-foreground">
                <span className="micro-label text-navy">Dejavu</span>
                Closest precedent: <span className="font-medium text-ink">{top.case_code}</span> ({top.similarity_score}
                %){top.lead_is_alumni && top.lead_name && ` · led by ${top.lead_name} (alumni)`}
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
                onSend={(content, isMilestone) => me && sendThread.mutate(newMessage(content, isMilestone))}
                onTyping={socket.notifyTyping}
                typingNames={socket.typing.map((p) => p.name)}
                error={sendThread.error?.message}
              />
            ) : (
              <MemoryBanner summary={t.summary} resolvedAt={t.resolved_at} indexJob={jobs.data?.index ?? null} />
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
                isOpenCase ? () => analyze.mutate({ caseId: t.id, jobId: crypto.randomUUID() }) : undefined
              }
              isStarting={analyze.isPending}
              onOpenFile={handleOpenArtifact}
              onOpenVault={() => router.push("/vault")}
              onOpenChannel={() => setTab("channel")}
            />
          </div>
        )}
        {tab === "people" && me && (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="max-w-xl">
              <MemberList
                noun="case"
                readOnly={!isOpenCase}
                members={t.members}
                people={people.data ?? []}
                currentUserId={me.id}
                isMember={t.members.some((m) => m.user.id === me.id)}
                departmentCodes={departmentCodes}
                onlineIds={new Set(socket.online.map((p) => p.id))}
                onAdd={(person) => changeMember.mutate({ kind: "add", person })}
                onRemove={(userId) => changeMember.mutate({ kind: "remove", userId })}
              />
              {changeMember.error && (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  {changeMember.error.message}
                </p>
              )}
            </div>
          </div>
        )}
        {tab === "copilot" && (
          <div className="flex min-h-0 flex-1 flex-col p-6">
            <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col">
              <CopilotPanel
                messages={copilotMessages}
                jobs={copilotJobs}
                chips={chips}
                error={askCopilot.error?.message ?? copilot.error?.message}
                onCaseClick={handleCaseClick}
                onAsk={(question) =>
                  askCopilot.mutate({ message_id: crypto.randomUUID(), job_id: crypto.randomUUID(), question })
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
              canUse={isOpenCase}
              onPreview={handleOpenArtifact}
              onUse={(file) => {
                sendThread.mutate(newMessage(`Reusing ${file.name} from ${file.caseCode}.`, false, file.id));
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
