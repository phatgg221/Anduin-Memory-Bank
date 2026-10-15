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
  vault: {
    all: ["vault"] as const,
    cases: (departmentId: string | null) => ["vault", "cases", departmentId ?? "ALL"] as const,
  },
  system: {
    health: ["system", "health"] as const,
  },
};
