// Mirrors backend app/modules/auth/schemas.py.
export interface User {
  id: string;
  email: string;
  name: string;
  avatar_initials: string;
  role: string;
  job_title: string | null;
  primary_department_id: string | null;
  /** Department view chosen in the header switcher; null = All Departments. */
  active_department_id: string | null;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

export interface Session {
  user: User;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
  confirm_password: string;
}
