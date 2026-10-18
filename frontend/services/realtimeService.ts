import PartySocket from "partysocket";
import { roomsService } from "@/services/roomsService";
import type { Presence, ServerEvent, SocketStatus } from "@/types/realtime";

// Browser → PartyServer directly (websockets don't go through the Next /api rewrite), like presigned MinIO links.
const HOST = process.env.NEXT_PUBLIC_REALTIME_HOST ?? "localhost:1999";
// Quiet sockets to the Worker get dropped (measured every ~90–180 s in an idle room); a small ping keeps them open.
const HEARTBEAT_MS = 20_000;

export interface RoomConnection {
  sendTyping: () => void;
  close: () => void;
}

interface Handlers {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: SocketStatus) => void;
}

/**
 * One socket per chat room (a department id, or case-<id>). On every (re)connect a one-minute room ticket, issued by
 * the API to members only, is sent as the first message, never in the URL; PartyServer closes sockets that don't
 * authenticate.
 */
export function connectRoom(departmentId: string, me: Presence, { onEvent, onStatus }: Handlers): RoomConnection {
  const socket = new PartySocket({ host: HOST, room: departmentId });
  // A closed connection's late events (its close fires after the replacement is live) must not touch the status.
  let closed = false;
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
  }, HEARTBEAT_MS);
  onStatus("connecting");

  socket.addEventListener("open", () => {
    roomsService
      .ticket(departmentId)
      .then((token) => {
        if (!closed && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "auth", token, user: me }));
        }
      })
      .catch(() => {
        if (closed) return;
        socket.close();
        onStatus("offline");
      });
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    if (closed) return;
    let parsed: ServerEvent;
    try {
      parsed = JSON.parse(event.data) as ServerEvent;
    } catch {
      return;
    }
    if (parsed.type === "ready") onStatus("live");
    onEvent(parsed);
  });
  socket.addEventListener("close", () => {
    if (!closed) onStatus("offline");
  });

  return {
    sendTyping: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "typing" }));
    },
    close: () => {
      closed = true;
      clearInterval(heartbeat);
      socket.close();
    },
  };
}
