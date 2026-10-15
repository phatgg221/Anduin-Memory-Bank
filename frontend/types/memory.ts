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
  kind: "SUMMARIZE" | "INDEX";
  status: JobStatus;
  step: string | null;
  steps: string[];
  attempts: number;
  error: string | null;
  result: (SummarizeResult & { chunks?: number; embedding_provider?: string }) | null;
  created_at: string;
  updated_at: string;
}

export interface CaseJobs {
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
