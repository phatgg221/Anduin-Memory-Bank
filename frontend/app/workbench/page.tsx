"use client";

import { ActionButton } from "@/components/brand/ActionButton";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { SystemStatus } from "@/components/system/SystemStatus";
import { useSystemHealth } from "@/store/system";

// 3-pane Swiss grid (DESIGN.md §4, View 2). Pane contents land once the feature set is agreed.
export default function WorkbenchPage() {
  const health = useSystemHealth();

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid flex-1 grid-cols-1 divide-y lg:grid-cols-[minmax(300px,1fr)_minmax(0,2fr)_minmax(280px,1fr)] lg:divide-x lg:divide-y-0">
        <section className="flex flex-col gap-6 bg-surface-2 p-6">
          <SectionLabel index={1}>Incoming request</SectionLabel>
          <p className="text-sm text-muted-foreground">
            Drop in a new fund-onboarding request, client ticket, or legal spec.
          </p>
          <ActionButton disabled className="w-full">
            Run Dejavu Analysis
          </ActionButton>
        </section>

        <section className="flex flex-col gap-6 p-6">
          <SectionLabel index={2}>Dejavu precedent &amp; delta engine</SectionLabel>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
            <IsometricStack />
            <p className="micro-label text-muted-foreground">No request analyzed yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The closest past cases, how they went, and what&apos;s different this time will appear here.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-6 p-6">
          <SectionLabel index={3}>Reusable kit &amp; source</SectionLabel>
          <p className="text-sm text-muted-foreground">
            Reusable artifacts and source citations from the matched case.
          </p>
        </section>
      </div>

      <SystemStatus health={health.data} isLoading={health.isPending} isError={health.isError} />
    </div>
  );
}
