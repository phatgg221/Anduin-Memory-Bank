"use client";

import { SystemStatus } from "@/components/system/SystemStatus";
import { useSystemHealth } from "@/store/system";

export default function WorkbenchPage() {
  const health = useSystemHealth();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Anduin Memory Bank</p>
        <h1 className="text-3xl font-semibold tracking-tight">Case Triage Workbench</h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          Drop in a new fund-onboarding request to see the most similar past cases, how they went, and
          what&apos;s different this time.
        </p>
      </header>

      <section className="rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
        Intake goes here once the feature set is agreed.
      </section>

      <SystemStatus health={health.data} isLoading={health.isPending} isError={health.isError} />
    </main>
  );
}
