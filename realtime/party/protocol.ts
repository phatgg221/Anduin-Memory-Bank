// Wire protocol for one department war room. Mirrored in frontend/types/realtime.ts.

export interface Presence {
  id: string;
  name: string;
  avatar_initials: string;
}

/** Browser → room. The socket must send `auth` first; anything else before it is ignored. */
export type ClientEvent =
  | { type: "auth"; token: string; user: Presence }
  | { type: "typing" };

/** Room → browser. `message.created` and `room.changed` originate from the API after it has persisted a write. */
export type ServerEvent =
  | { type: "ready"; presence: Presence[] }
  | { type: "presence"; presence: Presence[] }
  | { type: "typing"; user: Presence }
  | { type: "message.created"; message: unknown }
  | { type: "room.changed"; reason: "members" | "pinned_case" };

/** API → room (HTTP POST with the shared x-realtime-secret header). */
export type ApiEvent = Extract<ServerEvent, { type: "message.created" | "room.changed" }>;
