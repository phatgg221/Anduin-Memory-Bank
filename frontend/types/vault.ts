// Mirrors backend app/modules/vault/schemas.py.
export interface Person {
  id: string;
  name: string;
  avatar_initials: string;
  job_title: string | null;
  is_active: boolean;
  departed_at: string | null;
}

export interface Artifact {
  id: string;
  file_name: string;
  file_type: string;
  content_type: string;
  size_bytes: number;
  is_reusable: boolean;
  description: string;
}

export interface VaultCase {
  id: string;
  case_code: string;
  title: string;
  department_id: string;
  secondary_department_ids: string[];
  context_tags: Record<string, string>;
  summary: string | null;
  outcome?: string | null;
  final_output?: string | null;
  duration_days: number | null;
  created_at: string;
  resolved_at: string | null;
  lead_resolver: Person | null;
  artifacts: Artifact[];
}

export interface VaultView {
  department_id: string | null;
  total: number;
  counts: Record<string, number>;
  cases: VaultCase[];
}

export interface ArtifactLink {
  url: string;
  expires_in: number;
}
