import { jwtVerify } from "jose";
import type * as Party from "partykit/server";
import type { ApiEvent, ClientEvent, Presence, ServerEvent } from "./protocol";

/** Unauthenticated sockets are closed after this long. */
const AUTH_TIMEOUT_MS = 5_000;

type ConnectionState = { user: Presence } | null;

/**
 * One PartyKit room per department war room (room id = department id, e.g. LEGAL_COMPLIANCE).
 *
 * The room never stores messages. FastAPI persists every write, then POSTs the event here and the room fans it
 * out to the authenticated sockets. Browsers authenticate by sending their access token as the first message, so
 * tokens never appear in a URL.
 */
export default class WarRoom implements Party.Server {
  private readonly secret: Uint8Array;

  constructor(readonly room: Party.Room) {
    this.secret = new TextEncoder().encode(String(room.env.JWT_SECRET ?? ""));
  }

  onConnect(connection: Party.Connection<ConnectionState>) {
    setTimeout(() => {
      if (!connection.state) connection.close(4001, "Authentication required");
    }, AUTH_TIMEOUT_MS);
  }

  async onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection<ConnectionState>) {
    if (typeof raw !== "string") return;
    let event: ClientEvent;
    try {
      event = JSON.parse(raw) as ClientEvent;
    } catch {
      return;
    }

    if (event.type === "auth") {
      if (!(await this.verify(event.token, event.user.id))) return sender.close(4001, "Invalid token");
      sender.setState({ user: event.user });
      this.send(sender, { type: "ready", presence: this.presence() });
      this.broadcast({ type: "presence", presence: this.presence() }, sender.id);
      return;
    }
    if (!sender.state) return;
    if (event.type === "typing") this.broadcast({ type: "typing", user: sender.state.user }, sender.id);
  }

  onClose(connection: Party.Connection) {
    this.broadcast({ type: "presence", presence: this.presence(connection.id) });
  }

  async onRequest(request: Party.Request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = await request.text();
    if (request.headers.get("x-realtime-secret") !== this.room.env.REALTIME_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
    const event = JSON.parse(body) as ApiEvent;
    if (event.type !== "message.created" && event.type !== "room.changed") {
      return new Response("Unknown event", { status: 400 });
    }
    this.broadcast(event);
    return new Response(null, { status: 204 });
  }

  private async verify(token: string, userId: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
      return payload.type === "access" && payload.sub === userId;
    } catch {
      return false;
    }
  }

  private presence(closingId?: string): Presence[] {
    const users = new Map<string, Presence>();
    for (const connection of this.room.getConnections<ConnectionState>()) {
      if (connection.state && connection.id !== closingId) users.set(connection.state.user.id, connection.state.user);
    }
    return [...users.values()];
  }

  private send(connection: Party.Connection, event: ServerEvent) {
    connection.send(JSON.stringify(event));
  }

  /** Only authenticated sockets receive room traffic. */
  private broadcast(event: ServerEvent, except?: string) {
    const payload = JSON.stringify(event);
    for (const connection of this.room.getConnections<ConnectionState>()) {
      if (connection.state && connection.id !== except) connection.send(payload);
    }
  }
}

WarRoom satisfies Party.Worker;
