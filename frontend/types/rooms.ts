// Mirrors backend app/modules/rooms/schemas.py.
export interface RoomPerson {
  id: string;
  name: string;
  avatar_initials: string;
  job_title: string | null;
  primary_department_id: string | null;
  is_active: boolean;
  departed_at: string | null;
}

export interface RoomMember {
  user: RoomPerson;
  role: "LEAD" | "MEMBER";
  joined_at: string;
}

export interface RoomMessage {
  id: string;
  seq: number;
  department_id: string;
  author: RoomPerson | null;
  content: string;
  tagged_case_codes: string[];
  attached_artifact: { id: string; file_name: string; file_type: string } | null;
  is_milestone: boolean;
  created_at: string;
  /** Client-only: sent optimistically, not confirmed by the server yet. */
  pending?: boolean;
}

export interface RoomSummary {
  department_id: string;
  name: string;
  code: string;
  lead: RoomPerson | null;
  member_count: number;
  unread_count: number;
  last_message_at: string | null;
  is_member: boolean;
}

export interface CaseRef {
  id: string;
  case_code: string;
  title: string;
  status: string;
}

export interface Precedent {
  case_code: string;
  title: string;
  similarity_score: number;
  how_past_case_went: string;
  lead_name: string | null;
  lead_is_alumni: boolean;
}

export interface PinnedCase extends CaseRef {
  initial_request_brief: string;
  precedents: Precedent[];
}

export interface RoomView {
  department_id: string;
  name: string;
  code: string;
  lead_user_id: string | null;
  is_member: boolean;
  members: RoomMember[];
  pinned_case: PinnedCase | null;
  case_options: CaseRef[];
  messages: RoomMessage[];
  last_read_seq: number;
}

export interface SendMessageInput {
  id: string;
  content: string;
  is_milestone: boolean;
}
