import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/apiError";
import { memoryService } from "@/services/memoryService";
import type {
  CaseJob,
  CaseJobs,
  CommitInput,
  CommitResult,
  CopilotAsk,
  CopilotMessage,
  CopilotView,
  ResolveInput,
} from "@/types/memory";
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
      return isLive(data?.analyze) || isLive(data?.summarize) || isLive(data?.index) ? POLL_MS : false;
    },
  });
}

/** Not optimistic: only the server produces the draft. The job shows up at once and is polled from there. */
export function useResolve(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation<CaseJob, ApiRequestError, ResolveInput>({
    mutationFn: (input) => memoryService.resolve(caseId, input),
    onSuccess: (job) =>
      queryClient.setQueryData<CaseJobs>(queryKeys.cases.jobs(caseId), (old) => ({
        analyze: old?.analyze ?? null,
        summarize: job,
        index: old?.index ?? null,
      })),
  });
}

/** Irreversible, so not optimistic: a pending state until the server confirms. */
export function useCommitMemory(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation<CommitResult, ApiRequestError, CommitInput>({
    mutationFn: (record) => memoryService.commit(caseId, record),
    onSuccess: (result) => {
      queryClient.setQueryData<CaseJobs>(queryKeys.cases.jobs(caseId), (old) => ({
        analyze: old?.analyze ?? null,
        summarize: old?.summarize ?? null,
        index: result.index_job,
      }));
      queryClient.invalidateQueries({ queryKey: queryKeys.cases.thread(caseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.vault.all });
    },
  });
}

/** Not optimistic: only the server can rank precedents. The job appears at once and is polled. */
export function useAnalyze() {
  const queryClient = useQueryClient();
  return useMutation<CaseJob, ApiRequestError, { caseId: string; jobId: string }>({
    mutationFn: ({ caseId, jobId }) => memoryService.analyze(caseId, jobId),
    onSuccess: (job, { caseId }) =>
      queryClient.setQueryData<CaseJobs>(queryKeys.cases.jobs(caseId), (old) => ({
        analyze: job,
        summarize: old?.summarize ?? null,
        index: old?.index ?? null,
      })),
  });
}

/** Copilot conversation for a case; polls every 2 s while an answer is being written. */
export function useCopilot(caseId: string | null) {
  return useQuery<CopilotView, ApiRequestError>({
    queryKey: queryKeys.cases.copilot(caseId ?? ""),
    queryFn: () => memoryService.getCopilot(caseId!),
    enabled: caseId !== null,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return query.state.data?.jobs.some(isLive) ? POLL_MS : false;
    },
  });
}

/** The question shows at once (optimistic); the answer is server-produced and arrives through polling. */
export function useAskCopilot(caseId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.cases.copilot(caseId);
  return useMutation<CaseJob, ApiRequestError, CopilotAsk, { previous?: CopilotView }>({
    mutationFn: (input) => memoryService.askCopilot(caseId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CopilotView>(key);
      if (input.reply_in_channel) return { previous };
      const optimistic: CopilotMessage = {
        id: input.message_id,
        role: "user",
        content: input.question,
        user_id: null,
        cited_case_ids: [],
        cited_artifact_ids: [],
        created_at: new Date().toISOString(),
        pending: true,
      };
      queryClient.setQueryData<CopilotView>(key, (old) => ({
        messages: [...(old?.messages ?? []), optimistic],
        jobs: old?.jobs ?? [],
      }));
      return { previous };
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData(key, snapshot.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
