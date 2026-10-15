"use client";

import { useMemo } from "react";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Skeleton } from "@/components/ui/skeleton";
import { DepartmentTabs } from "@/components/vault/DepartmentTabs";
import { VaultCaseCard } from "@/components/vault/VaultCaseCard";
import { useSession } from "@/store/auth";
import { useDepartments, useSetActiveDepartment } from "@/store/org";
import { useOpenArtifact, useVaultCases } from "@/store/vault";

export default function VaultPage() {
  const user = useSession().data?.user;
  const activeId = user?.active_department_id ?? null;
  const departments = useDepartments(Boolean(user));
  const vault = useVaultCases(activeId, Boolean(user));
  const setDepartment = useSetActiveDepartment();
  const openArtifact = useOpenArtifact();

  const departmentCodes = useMemo(
    () => Object.fromEntries((departments.data ?? []).map((d) => [d.id, d.code])),
    [departments.data],
  );
  const activeName = departments.data?.find((d) => d.id === activeId)?.name ?? "All Departments";

  const handleOpenArtifact = (artifactId: string) => {
    // Open the tab inside the click (popup blockers allow that), then point it at the fresh presigned link.
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

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b bg-surface-2 px-6 py-5">
        <SectionLabel>Knowledge Vault</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Resolved cases and their reusable artifacts · <span className="text-ink">{activeName}</span>
          {vault.data && ` · ${vault.data.cases.length} case${vault.data.cases.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {departments.data && vault.data && (
        <DepartmentTabs
          departments={departments.data}
          activeId={activeId}
          counts={vault.data.counts}
          total={vault.data.total}
          onSelect={(id) => setDepartment.mutate(id)}
        />
      )}

      <div className="flex flex-1 flex-col gap-4 p-6">
        {(openArtifact.error ?? vault.error) && (
          <p role="alert" className="border border-destructive px-3 py-2 text-sm text-destructive">
            {(openArtifact.error ?? vault.error)?.message}
          </p>
        )}

        {vault.isPending && !vault.error && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        )}

        {vault.data && vault.data.cases.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
            <IsometricStack />
            <p className="micro-label text-muted-foreground">No resolved cases for {activeName} yet</p>
          </div>
        )}

        {vault.data && vault.data.cases.length > 0 && (
          <div className={vault.isPlaceholderData ? "grid grid-cols-1 gap-4 opacity-60 xl:grid-cols-2" : "grid grid-cols-1 gap-4 xl:grid-cols-2"}>
            {vault.data.cases.map((item) => (
              <VaultCaseCard
                key={item.id}
                item={item}
                departmentCodes={departmentCodes}
                onOpenArtifact={handleOpenArtifact}
                openingArtifactId={openArtifact.isPending ? openArtifact.variables : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
