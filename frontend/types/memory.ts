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

export interface SummarizeResult {
  record: MemoryRecord;
  guard_warnings: string[];
  provider: string;
}

export interface CaseJob {
  id: string;
  case_id: string;
  kind: "ANALYZE" | "SUMMARIZE" | "INDEX" | "COPILOT";
  status: JobStatus;
  step: string | null;
  steps: string[];
  in_channel?: boolean;
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
