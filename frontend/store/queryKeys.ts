export const queryKeys = {
  auth: {
    session: ["auth", "session"] as const,
  },
  org: {
    departments: ["org", "departments"] as const,
  },
  vault: {
    all: ["vault"] as const,
    cases: (departmentId: string | null) => ["vault", "cases", departmentId ?? "ALL"] as const,
  },
  system: {
    health: ["system", "health"] as const,
  },
};
