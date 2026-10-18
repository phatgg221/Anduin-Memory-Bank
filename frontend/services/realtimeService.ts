import PartySocket from "partysocket";
import { roomsService } from "@/services/roomsService";
import type { Presence, ServerEvent, SocketStatus } from "@/types/realtime";

// Browser → PartyServer directly (websockets don't go through the Next /api rewrite), like presigned MinIO links.
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
 * One socket per chat room (a department id, or case-<id>). On every (re)connect a one-minute room ticket, issued by
 * the API to members only, is sent as the first message, never in the URL; PartyServer closes sockets that don't
 * authenticate.
 */
export function connectRoom(departmentId: string, me: Presence, { onEvent, onStatus }: Handlers): RoomConnection {
  const socket = new PartySocket({ host: HOST, room: departmentId });
  onStatus("connecting");

  socket.addEventListener("open", () => {
    roomsService
      .ticket(departmentId)
      .then((token) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "auth", token, user: me }));
      })
      .catch(() => {
        socket.close();
        onStatus("offline");
      });
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
