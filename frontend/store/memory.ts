import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/apiError";
import { memoryService } from "@/services/memoryService";
import type { CaseJob, CaseJobs, CommitResult, MemoryRecord } from "@/types/memory";
import { queryKeys } from "./queryKeys";

const POLL_MS = 2_000;
const isLive = (job: CaseJob | null | undefined) => job?.status === "QUEUED" || job?.status === "PROCESSING";

/** Latest SUMMARIZE and INDEX jobs for a case; polls every 2 s while either is running, then stops. */
export function useCaseJobs(caseId: string | null) {
  return useQuery<CaseJobs, ApiRequestError>({
    queryKey: queryKeys.cases.jobs(caseId ?? ""),
    queryFn: () => memoryService.getJobs(caseId!),
    enabled: caseId !== null,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const data = query.state.data;
      return isLive(data?.summarize) || isLive(data?.index) ? POLL_MS : false;
    },
  });
}

/** Not optimistic: only the server produces the draft. The job shows up at once and is polled from there. */
export function useResolve(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation<CaseJob, ApiRequestError, string>({
    mutationFn: (jobId) => memoryService.resolve(caseId, jobId),
    onSuccess: (job) =>
      queryClient.setQueryData<CaseJobs>(queryKeys.cases.jobs(caseId), (old) => ({
        summarize: job,
        index: old?.index ?? null,
      })),
  });
}

/** Irreversible, so not optimistic: a pending state until the server confirms. */
export function useCommitMemory(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation<CommitResult, ApiRequestError, MemoryRecord>({
    mutationFn: (record) => memoryService.commit(caseId, record),
    onSuccess: (result) => {
      queryClient.setQueryData<CaseJobs>(queryKeys.cases.jobs(caseId), (old) => ({
        summarize: old?.summarize ?? null,
        index: result.index_job,
      }));
      queryClient.invalidateQueries({ queryKey: queryKeys.cases.thread(caseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.vault.all });
    },
  });
}
