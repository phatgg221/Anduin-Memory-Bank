"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ActiveCaseList } from "@/components/workspace/ActiveCaseList";
import { DepartmentChannels } from "@/components/workspace/DepartmentChannels";
import { IntakePanel, type IntakeSubmission } from "@/components/workspace/IntakePanel";
import { DEMO_SCENARIOS } from "@/lib/demoScenarios";
import { useSession } from "@/store/auth";
import { useAnalyze } from "@/store/memory";
import { useDepartments } from "@/store/org";
import { useRooms } from "@/store/rooms";
import { useCreateCase, useOpenCases, useUploadFiles } from "@/store/threads";

export default function WorkbenchHub() {
  const router = useRouter();
  const user = useSession().data?.user;
  const signedIn = Boolean(user);
  const departmentId = user?.active_department_id ?? null;

  const departments = useDepartments(signedIn);
  const openCases = useOpenCases(departmentId, signedIn);
  const rooms = useRooms(signedIn);
  const createCase = useCreateCase();
  const upload = useUploadFiles();
  const analyze = useAnalyze();

  const departmentCodes = useMemo(
    () => Object.fromEntries((departments.data ?? []).map((d) => [d.id, d.code])),
    [departments.data],
  );
  const fundSuggestions = [
    ...new Set((openCases.data ?? []).map((c) => c.fund_name).filter((f): f is string => Boolean(f))),
  ];

  const [runStage, setRunStage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | undefined>();
  const runIntake = async ({ intake, files, departmentId: scenarioDepartment }: IntakeSubmission) => {
    if (!user) return;
    setRunError(undefined);
    const owner = scenarioDepartment ?? departmentId ?? user.primary_department_id ?? "CLIENT_OPERATIONS";
    try {
      setRunStage("Opening the case room…");
      const created = await createCase.mutateAsync({
        id: crypto.randomUUID(),
        department_id: owner,
        lead_user_id: user.id,
        ...intake,
      });
      if (files.length) {
        setRunStage(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
        await upload.mutateAsync({ caseId: created.id, files });
      }
      setRunStage("Starting the analysis…");
      await analyze.mutateAsync({ caseId: created.id, jobId: crypto.randomUUID() });
      router.push(`/workbench/cases/${created.id}?tab=delta`);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Couldn't open the case room.");
    } finally {
      setRunStage(null);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside
        aria-label="New case"
        className="shrink-0 border-b bg-surface-2 p-5 lg:w-[420px] lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        <IntakePanel
          scenarios={DEMO_SCENARIOS}
          fundSuggestions={fundSuggestions}
          onRun={runIntake}
          isRunning={runStage !== null}
          runLabel={runStage ?? undefined}
          error={runError}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-8 p-6 lg:overflow-y-auto">
        {rooms.data ? (
          <DepartmentChannels
            rooms={rooms.data}
            activeDepartmentId={departmentId}
            onOpen={(id) => router.push(`/workbench/rooms/${id}`)}
          />
        ) : (
          <Skeleton className="h-32" />
        )}
        {openCases.data ? (
          <ActiveCaseList
            cases={openCases.data}
            departmentCodes={departmentCodes}
            onOpen={(id) => router.push(`/workbench/cases/${id}`)}
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    </div>
  );
}
