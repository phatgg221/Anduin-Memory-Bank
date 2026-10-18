import { jwtVerify } from "jose";
import { routePartykitRequest, Server, type Connection, type WSMessage } from "partyserver";
import type { ApiEvent, ClientEvent, Presence, ServerEvent } from "./protocol";

/** Unauthenticated sockets are closed after this long. */
const AUTH_TIMEOUT_MS = 5_000;

type ConnectionState = { user: Presence } | null;

interface Env {
  Main: DurableObjectNamespace<Main>;
  JWT_SECRET: string;
  REALTIME_SECRET: string;
}

/**
 * One PartyServer room (a Durable Object) per chat room: a department id, or `case-<uuid>` for a case thread.
 *
 * The room never stores messages. FastAPI persists every write, then POSTs the event here and the room fans it
 * out to the authenticated sockets. Browsers authenticate by sending a one-minute room ticket (issued by the API to
 * members of that chat only) as the first message, so
 * tokens never appear in a URL.
 */
export class Main extends Server<Env> {
  onConnect(connection: Connection<ConnectionState>) {
    setTimeout(() => {
      if (!connection.state) connection.close(4001, "Authentication required");
    }, AUTH_TIMEOUT_MS);
  }

  async onMessage(sender: Connection<ConnectionState>, raw: WSMessage) {
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
      this.fanOut({ type: "presence", presence: this.presence() }, sender.id);
      return;
    }
    if (!sender.state) return;
    if (event.type === "typing") this.fanOut({ type: "typing", user: sender.state.user }, sender.id);
  }

  onClose(connection: Connection) {
    this.fanOut({ type: "presence", presence: this.presence(connection.id) });
  }

  async onRequest(request: Request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = await request.text();
    if (request.headers.get("x-realtime-secret") !== this.env.REALTIME_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
    const event = JSON.parse(body) as ApiEvent;
    if (event.type !== "message.created" && event.type !== "room.changed") {
      return new Response("Unknown event", { status: 400 });
    }
    this.fanOut(event);
    return new Response(null, { status: 204 });
  }

  private async verify(token: string, userId: string): Promise<boolean> {
    try {
      const secret = new TextEncoder().encode(String(this.env.JWT_SECRET ?? ""));
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      return payload.type === "room" && payload.room === this.name && payload.sub === userId;
    } catch {
      return false;
    }
  }

  private presence(closingId?: string): Presence[] {
    const users = new Map<string, Presence>();
    for (const connection of this.getConnections<ConnectionState>()) {
      if (connection.state && connection.id !== closingId) users.set(connection.state.user.id, connection.state.user);
    }
    return [...users.values()];
  }

  private send(connection: Connection, event: ServerEvent) {
    connection.send(JSON.stringify(event));
  }

  /** Only authenticated sockets receive room traffic. */
  private fanOut(event: ServerEvent, except?: string) {
    const payload = JSON.stringify(event);
    for (const connection of this.getConnections<ConnectionState>()) {
      if (connection.state && connection.id !== except) connection.send(payload);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
