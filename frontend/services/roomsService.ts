import { withApiErrors } from "@/lib/apiError";
import { axiosClient } from "@/lib/axiosClient";
import type { RoomMessage, RoomPerson, RoomSummary, RoomView, SendMessageInput } from "@/types/rooms";

const room = (departmentId: string) => `/rooms/${encodeURIComponent(departmentId)}`;

export const roomsService = {
  async listRooms(): Promise<RoomSummary[]> {
    return (await withApiErrors(axiosClient.get<RoomSummary[]>("/rooms"))).data;
  },

  async listPeople(): Promise<RoomPerson[]> {
    return (await withApiErrors(axiosClient.get<RoomPerson[]>("/rooms/people"))).data;
  },

  async getRoom(departmentId: string): Promise<RoomView> {
    return (await withApiErrors(axiosClient.get<RoomView>(room(departmentId)))).data;
  },

  async getMessagesAfter(departmentId: string, afterSeq: number): Promise<RoomMessage[]> {
    const params = { after_seq: afterSeq };
    return (await withApiErrors(axiosClient.get<RoomMessage[]>(`${room(departmentId)}/messages`, { params }))).data;
  },

  /** Idempotent on the client-generated id: safe to retry. */
  async sendMessage(departmentId: string, input: SendMessageInput): Promise<RoomMessage> {
    return (await withApiErrors(axiosClient.post<RoomMessage>(`${room(departmentId)}/messages`, input))).data;
  },

  async addMember(departmentId: string, userId: string): Promise<void> {
    await withApiErrors(axiosClient.put(`${room(departmentId)}/members/${userId}`));
  },

  async removeMember(departmentId: string, userId: string): Promise<void> {
    await withApiErrors(axiosClient.delete(`${room(departmentId)}/members/${userId}`));
  },

  async setPinnedCase(departmentId: string, caseId: string | null): Promise<void> {
    await withApiErrors(axiosClient.put(`${room(departmentId)}/pinned-case`, { case_id: caseId }));
  },

  async markRead(departmentId: string, seq: number): Promise<void> {
    await withApiErrors(axiosClient.put(`${room(departmentId)}/read`, { seq }));
  },
};
