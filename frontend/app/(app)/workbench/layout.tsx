"use client";

import type { ReactNode } from "react";
import { SystemStatus } from "@/components/system/SystemStatus";
import { useSystemHealth } from "@/store/system";

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  const health = useSystemHealth();
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex min-h-0 flex-1">{children}</div>
      <SystemStatus health={health.data} isLoading={health.isPending} isError={health.isError} />
    </div>
  );
}
