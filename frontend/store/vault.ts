import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/apiError";
import { vaultService } from "@/services/vaultService";
import type { ArtifactLink, VaultView } from "@/types/vault";
import { queryKeys } from "./queryKeys";

/** The Knowledge Vault screen in one request: resolved cases for the department (null = all) plus counts. */
export function useVaultCases(departmentId: string | null, enabled = true) {
  return useQuery<VaultView, ApiRequestError>({
    queryKey: queryKeys.vault.cases(departmentId),
    queryFn: () => vaultService.getCases(departmentId),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Opens an artifact through a fresh presigned link (server-computed, so not optimistic). */
export function useOpenArtifact() {
  return useMutation<ArtifactLink, ApiRequestError, string>({
    mutationFn: vaultService.getArtifactLink,
    retry: false,
  });
}
