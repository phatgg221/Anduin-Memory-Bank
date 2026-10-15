// Mirrors realtime/party/protocol.ts (the PartyKit war-room protocol).
import type { RoomMessage } from "./rooms";

export interface Presence {
  id: string;
  name: string;
  avatar_initials: string;
}

export type ServerEvent =
  | { type: "ready"; presence: Presence[] }
  | { type: "presence"; presence: Presence[] }
  | { type: "typing"; user: Presence }
  | { type: "message.created"; message: RoomMessage }
  | { type: "room.changed"; reason: "members" | "pinned_case" | "threads" };

export type SocketStatus = "connecting" | "live" | "offline";
