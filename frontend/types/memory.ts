// Mirrors backend app/modules/triage/schemas.py and intelligence/schemas.py.

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface MemoryPitfall {
  warning: string;
  severity: Severity;
  reference: string | null;
  /** Set by the server from the cited message; never edited in the UI. */
  authorId?: string | null;
  messageId?: string | null;
}

export interface MemoryRecord {
  summary: string;
  how_it_went: string;
  resolution_steps: string[];
  pitfalls: MemoryPitfall[];
  context_tags: Record<string, string>;
}

export type CaseOutcome = "RESOLVED" | "WORKAROUND" | "PARTIAL" | "ESCALATED" | "WITHDRAWN";

export const CASE_OUTCOMES: { id: CaseOutcome; label: string; hint: string }[] = [
  { id: "RESOLVED", label: "Resolved", hint: "Fully solved and delivered" },
  { id: "WORKAROUND", label: "Workaround", hint: "Unblocked, but not the final fix" },
  { id: "PARTIAL", label: "Partial", hint: "Some of it delivered, the rest deferred" },
  { id: "ESCALATED", label: "Escalated", hint: "Handed to another team or vendor" },
  { id: "WITHDRAWN", label: "Withdrawn", hint: "The client dropped the request" },
];

export interface OutcomeInput {
  outcome: CaseOutcome;
  final_output: string;
  deliverable_file_ids: string[];
}

export interface ResolveInput extends OutcomeInput {
  job_id: string;
}

export interface CuratorSuggestions {
  reusable_files: { artifact_id: string; file_name: string; reason: string }[];
  contradictions: { case_code: string; case_id: string; existing: string; new: string; explanation: string }[];
  checked_cases: string[];
}

export interface SummarizeResult {
  record: MemoryRecord;
  guard_warnings: string[];
  provider: string;
  outcome?: CaseOutcome | null;
  final_output?: string | null;
  deliverable_file_ids?: string[];
  curator?: CuratorSuggestions;
}

export interface CommitInput extends MemoryRecord {
  outcome: CaseOutcome;
  final_output: string;
  reusable_file_ids: string[];
}

export interface CaseJob {
  id: string;
  case_id: string;
  kind: "ANALYZE" | "SUMMARIZE" | "INDEX" | "COPILOT";
  status: JobStatus;
  step: string | null;
  steps: string[];
  in_channel?: boolean;
  asked_message_id?: string | null;
  requested_by_user_id?: string | null;
  trace?: TraceEvent[];
  attempts: number;
  error: string | null;
  result:
    | (Partial<SummarizeResult> & {
        chunks?: number;
        embedding_provider?: string;
        matches?: { caseCode: string; similarityScore: number }[];
        guard_warnings?: string[];
      })
    | null;
  created_at: string;
  updated_at: string;
}

export interface CaseJobs {
  analyze: CaseJob | null;
  summarize: CaseJob | null;
  index: CaseJob | null;
}

export interface CommitResult {
  case_id: string;
  case_code: string;
  status: string;
  index_job: CaseJob;
  guard_warnings: string[];
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  user_id: string | null;
  cited_case_ids: string[];
  cited_artifact_ids: string[];
  created_at: string;
  /** Client-only: asked optimistically. */
  pending?: boolean;
}

export interface CopilotView {
  messages: CopilotMessage[];
  jobs: CaseJob[];
}

/** `reply_in_channel`: asked with @Dejavu in the case channel; the answer is posted there. */
export interface CopilotAsk {
  message_id: string;
  job_id: string;
  question: string;
  reply_in_channel?: boolean;
}

export interface TraceEvent {
  id: string;
  tool: string;
  label: string;
  detail: string;
  auto?: boolean;
  at: string;
}

export interface TriagePerson {
  user_id: string;
  name: string;
  job_title: string | null;
  department_id: string | null;
  active: boolean;
  departed_at: string | null;
  cases: string[];
  led: string[];
  handoff?: { user_id: string; name: string }[];
  reason: string;
}

export interface TriageDuplicate {
  case_code: string;
  case_id: string;
  title: string;
  client: string | null;
  similarity: number | null;
  same_client: boolean;
  owner: string | null;
  severity: string;
  reason: string;
}

export interface TriageReport {
  summary: string;
  risk: { level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; reasons: string[] };
  effort: {
    durations: Record<string, number>;
    median_days: number | null;
    range_days: [number, number] | null;
    days_until_deadline: number | null;
    fits_deadline: boolean | null;
  } | null;
  missing_info: { question: string; why: string; source_case_code: string | null }[];
  team: TriagePerson[];
  duplicates: TriageDuplicate[];
  investigation: {
    tool_calls: number;
    repeats_skipped?: number;
    queries: string[];
    cases_opened: string[];
    agent: boolean;
    model: string;
  };
  guard_warnings: string[];
  fallback?: boolean;
}
