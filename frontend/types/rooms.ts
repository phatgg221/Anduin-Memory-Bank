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

/** A chat message, in a department room or a case thread. */
export interface ChatMessage {
  id: string;
  seq: number;
  author: RoomPerson | null;
  content: string;
  tagged_case_codes: string[];
  attached_artifact: { id: string; file_name: string; file_type: string } | null;
  is_milestone: boolean;
  created_at: string;
  /** Client-only: sent optimistically, not confirmed by the server yet. */
  pending?: boolean;
}

export interface RoomMessage extends ChatMessage {
  department_id: string;
}

export interface ThreadMessage extends ChatMessage {
  case_id: string;
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** An open case's sub-chat, listed under every department it involves. */
export interface ThreadSummary {
  id: string;
  case_code: string;
  title: string;
  status: string;
  client_name: string | null;
  severity: Severity;
  due_date: string | null;
  department_id: string;
  secondary_department_ids: string[];
  message_count: number;
  last_message_at: string | null;
}

export interface CaseFile {
  id: string;
  file_name: string;
  file_type: string;
  is_reusable: boolean;
  description: string;
}

export interface ThreadView {
  id: string;
  case_code: string;
  title: string;
  status: string;
  client_name: string | null;
  severity: Severity;
  due_date: string | null;
  department_id: string;
  secondary_department_ids: string[];
  initial_request_brief: string;
  context_tags: Record<string, string>;
  created_by: RoomPerson | null;
  /** The owner: accountable for the case (stored as the case's lead). */
  lead: RoomPerson | null;
  created_at: string;
  artifacts: CaseFile[];
  /** Set once the case is committed to memory. */
  summary: string | null;
  resolved_at: string | null;
  precedents: Precedent[];
  participants: RoomPerson[];
  messages: ThreadMessage[];
}

/** The intake fields shared by "New case thread" and "Edit details". */
export interface CaseIntake {
  client_name: string;
  title: string;
  initial_request_brief: string;
  severity: Severity;
  due_date: string | null;
  lead_user_id: string | null;
  context_tags: Record<string, string>;
  secondary_department_ids: string[];
}

export interface CreateCaseInput extends CaseIntake {
  id: string;
  department_id: string;
}

export type UpdateCaseInput = Partial<CaseIntake>;

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
  threads: ThreadSummary[];
  messages: RoomMessage[];
  last_read_seq: number;
}

export interface SendMessageInput {
  id: string;
  content: string;
  is_milestone: boolean;
}
