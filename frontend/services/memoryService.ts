import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type { CaseJob, CaseJobs, CommitResult, CopilotView, MemoryRecord } from "@/types/memory";

export const memoryService = {
  /** Starts precedent matching (top-3 + delta). Idempotent on the client-generated job id. */
  async analyze(caseId: string, jobId: string): Promise<CaseJob> {
    return (await withApiErrors(axiosClient.post<CaseJob>(`/cases/${caseId}/analyze`, { job_id: jobId }))).data;
  },

  async getCopilot(caseId: string): Promise<CopilotView> {
    return (await withApiErrors(axiosClient.get<CopilotView>(`/cases/${caseId}/copilot`))).data;
  },

  /** Idempotent on both client-generated ids (the question and its answer job). */
  async askCopilot(caseId: string, input: { message_id: string; job_id: string; question: string }): Promise<CaseJob> {
    return (await withApiErrors(axiosClient.post<CaseJob>(`/cases/${caseId}/copilot`, input))).data;
  },

  /** Starts the summarizer job. Idempotent on the client-generated job id. */
  async resolve(caseId: string, jobId: string): Promise<CaseJob> {
    return (await withApiErrors(axiosClient.post<CaseJob>(`/cases/${caseId}/resolve`, { job_id: jobId }))).data;
  },

  async getJobs(caseId: string): Promise<CaseJobs> {
    return (await withApiErrors(axiosClient.get<CaseJobs>(`/cases/${caseId}/jobs`))).data;
  },

  /** Irreversible: the case becomes RESOLVED and its thread read-only. */
  async commit(caseId: string, record: MemoryRecord): Promise<CommitResult> {
    const pitfalls = record.pitfalls.map(({ warning, severity, reference }) => ({ warning, severity, reference }));
    return (await withApiErrors(axiosClient.post<CommitResult>(`/cases/${caseId}/commit`, { ...record, pitfalls }))).data;
  },
};
