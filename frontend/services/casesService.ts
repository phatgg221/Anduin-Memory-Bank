import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type {
  CaseFile,
  CreateCaseInput,
  SendMessageInput,
  ThreadMessage,
  ThreadSummary,
  ThreadView,
  UpdateCaseInput,
} from "@/types/rooms";

const thread = (caseId: string) => `/cases/${caseId}/thread`;

export const casesService = {
  /** Active case rooms: open cases for a department (null = all), newest activity first. */
  async listOpen(departmentId: string | null): Promise<ThreadSummary[]> {
    const params = departmentId ? { department_id: departmentId } : undefined;
    return (await withApiErrors(axiosClient.get<ThreadSummary[]>("/cases", { params }))).data;
  },

  /** Attach a file to an open case. Re-uploading the same file name replaces it. */
  async uploadFile(caseId: string, file: File, fileType = "CLIENT_BRIEF"): Promise<CaseFile> {
    const form = new FormData();
    form.append("file", file);
    form.append("file_type", fileType);
    return (await withApiErrors(axiosClient.post<CaseFile>(`/cases/${caseId}/files`, form))).data;
  },

  async getThread(caseId: string): Promise<ThreadView> {
    return (await withApiErrors(axiosClient.get<ThreadView>(thread(caseId)))).data;
  },

  async getThreadMessagesAfter(caseId: string, afterSeq: number): Promise<ThreadMessage[]> {
    const params = { after_seq: afterSeq };
    return (await withApiErrors(axiosClient.get<ThreadMessage[]>(`${thread(caseId)}/messages`, { params }))).data;
  },

  /** Idempotent on the client-generated id: safe to retry. */
  async sendThreadMessage(caseId: string, input: SendMessageInput): Promise<ThreadMessage> {
    return (await withApiErrors(axiosClient.post<ThreadMessage>(`${thread(caseId)}/messages`, input))).data;
  },

  /** PATCH with explicit values: idempotent. Returns the full thread view for reconciliation. */
  async updateCase(caseId: string, input: UpdateCaseInput): Promise<ThreadView> {
    return (await withApiErrors(axiosClient.patch<ThreadView>(`/cases/${caseId}`, input))).data;
  },

  async addMember(caseId: string, userId: string): Promise<void> {
    await withApiErrors(axiosClient.put(`/cases/${caseId}/members/${userId}`));
  },

  async removeMember(caseId: string, userId: string): Promise<void> {
    await withApiErrors(axiosClient.delete(`/cases/${caseId}/members/${userId}`));
  },

  /** Idempotent on the client-generated id; the server assigns the case code. */
  async createCase(input: CreateCaseInput): Promise<ThreadSummary> {
    return (await withApiErrors(axiosClient.post<ThreadSummary>("/cases", input))).data;
  },
};
