import PartySocket from "partysocket";
import { accessTokenStore } from "@/lib/accessToken";
import type { Presence, ServerEvent, SocketStatus } from "@/types/realtime";

// Browser → PartyKit directly (websockets don't go through the Next /api rewrite), like presigned MinIO links.
const HOST = process.env.NEXT_PUBLIC_REALTIME_HOST ?? "localhost:1999";

export interface RoomConnection {
  sendTyping: () => void;
  close: () => void;
}

interface Handlers {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: SocketStatus) => void;
}

/**
 * One socket per department war room: PartyKit room id = department id. The access token is sent as the first
 * message on every (re)connect, never in the URL; PartyKit closes sockets that don't authenticate.
 */
export function connectRoom(departmentId: string, me: Presence, { onEvent, onStatus }: Handlers): RoomConnection {
  const socket = new PartySocket({ host: HOST, room: departmentId });
  onStatus("connecting");

  socket.addEventListener("open", () => {
    const token = accessTokenStore.get();
    if (token) socket.send(JSON.stringify({ type: "auth", token, user: me }));
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    let parsed: ServerEvent;
    try {
      parsed = JSON.parse(event.data) as ServerEvent;
    } catch {
      return;
    }
    if (parsed.type === "ready") onStatus("live");
    onEvent(parsed);
  });
  socket.addEventListener("close", () => onStatus("offline"));

  return {
    sendTyping: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "typing" }));
    },
    close: () => socket.close(),
  };
}
