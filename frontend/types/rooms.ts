import type { TriageReport } from "./memory";

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
  is_agent?: boolean;
  mentioned_user_ids?: string[];
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
export type SourceType = "CLIENT_EMAIL" | "CS_ESCALATION" | "LEGAL_REDLINE" | "SECURITY_RFP";
export const SOURCE_TYPES: { id: SourceType; label: string }[] = [
  { id: "CLIENT_EMAIL", label: "Client email" },
  { id: "CS_ESCALATION", label: "CS escalation" },
  { id: "LEGAL_REDLINE", label: "Legal redline" },
  { id: "SECURITY_RFP", label: "Security RFP" },
];

/** An open case's sub-chat, listed under every department it involves. */
export interface ThreadSummary {
  id: string;
  case_code: string;
  title: string;
  status: string;
  client_name: string | null;
  fund_name: string | null;
  source_type: SourceType | null;
  severity: Severity;
  due_date: string | null;
  department_id: string;
  secondary_department_ids: string[];
  top_match_code: string | null;
  top_match_score: number | null;
  message_count: number;
  last_message_at: string | null;
}

export interface CaseFile {
  id: string;
  file_name: string;
  file_type: string;
  is_reusable: boolean;
  description: string;
  text_status?: "PENDING" | "READY" | "UNREADABLE";
}

export interface DeltaItem {
  category: string;
  past_approach: string;
  current_requirement: string;
  status: "REUSABLE" | "MODIFIED" | "NET_NEW";
  action_recommendation: string;
  source_artifact: string | null;
  source_artifact_id: string | null;
}

export interface PrecedentFile extends CaseFile {
  uploaded_by: RoomPerson | null;
}

/** A matched past case with everything the delta tab and the reusable kit show. */
export interface PrecedentDetail {
  case_id: string | null;
  case_code: string;
  title: string;
  client_name: string | null;
  department_id: string | null;
  secondary_department_ids: string[];
  similarity_score: number;
  score_breakdown: { vector: number; metadataBoost: number } | null;
  how_past_case_went: string;
  pitfall_warnings: string[];
  summary: string | null;
  how_it_went: string | null;
  duration_days: number | null;
  resolved_at: string | null;
  lead: RoomPerson | null;
  lead_name: string | null;
  lead_is_alumni: boolean;
  delta_items: DeltaItem[];
  artifacts: PrecedentFile[];
}

export interface ThreadView {
  id: string;
  case_code: string;
  channel_slug: string;
  title: string;
  status: string;
  client_name: string | null;
  fund_name: string | null;
  source_type: SourceType | null;
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
  outcome?: string | null;
  final_output?: string | null;
  resolved_at: string | null;
  precedents: PrecedentDetail[];
  triage_report?: TriageReport | null;
  participants: RoomPerson[];
  members: RoomMember[];
  messages: ThreadMessage[];
}

/** The intake fields shared by "New case thread" and "Edit details". */
export interface CaseIntake {
  client_name: string;
  fund_name: string | null;
  source_type: SourceType | null;
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
  member_ids?: string[];
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
  /** A file from any case, e.g. a precedent's deliverable reused here. */
  attached_artifact_id?: string;
  mentioned_user_ids?: string[];
}
