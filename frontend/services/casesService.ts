import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type { CreateCaseInput, SendMessageInput, ThreadMessage, ThreadSummary, ThreadView } from "@/types/rooms";

const thread = (caseId: string) => `/cases/${caseId}/thread`;

export const casesService = {
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

  /** Idempotent on the client-generated id; the server assigns the case code. */
  async createCase(input: CreateCaseInput): Promise<ThreadSummary> {
    return (await withApiErrors(axiosClient.post<ThreadSummary>("/cases", input))).data;
  },
};
