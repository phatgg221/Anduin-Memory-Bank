import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type { CaseJob, CaseJobs, CommitResult, MemoryRecord } from "@/types/memory";

export const memoryService = {
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
