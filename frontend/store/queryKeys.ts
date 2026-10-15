export const queryKeys = {
  auth: {
    session: ["auth", "session"] as const,
  },
  org: {
    departments: ["org", "departments"] as const,
  },
  rooms: {
    all: ["rooms"] as const,
    list: ["rooms", "list"] as const,
    people: ["rooms", "people"] as const,
    room: (departmentId: string) => ["rooms", "room", departmentId] as const,
    poll: (departmentId: string) => ["rooms", "poll", departmentId] as const,
  },
  cases: {
    thread: (caseId: string) => ["cases", "thread", caseId] as const,
    poll: (caseId: string) => ["cases", "poll", caseId] as const,
    jobs: (caseId: string) => ["cases", "jobs", caseId] as const,
    copilot: (caseId: string) => ["cases", "copilot", caseId] as const,
    open: (departmentId: string | null) => ["cases", "open", departmentId ?? "ALL"] as const,
  },
  vault: {
    all: ["vault"] as const,
    cases: (departmentId: string | null) => ["vault", "cases", departmentId ?? "ALL"] as const,
  },
  system: {
    health: ["system", "health"] as const,
  },
};
