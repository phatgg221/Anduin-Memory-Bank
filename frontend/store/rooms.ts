import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { retryTransient, type ApiRequestError } from "@/lib/apiError";
import { connectRoom, type RoomConnection } from "@/services/realtimeService";
import { roomsService } from "@/services/roomsService";
import type { Presence, SocketStatus } from "@/types/realtime";
import type {
  AccessRequest,
  ChatMessage,
  RoomMessage,
  RoomPerson,
  RoomSummary,
  RoomView,
  SendMessageInput,
} from "@/types/rooms";
import { queryKeys } from "./queryKeys";

const POLL_MS = 3_000;
/** While the socket is live, polling only backstops missed events. */
const FALLBACK_POLL_MS = 30_000;
const TYPING_VISIBLE_MS = 4_000;
const TYPING_THROTTLE_MS = 2_000;

export function useRooms(enabled = true) {
  return useQuery<RoomSummary[], ApiRequestError>({
    queryKey: queryKeys.rooms.list,
    queryFn: roomsService.listRooms,
    refetchInterval: 10_000,
    enabled,
  });
}

export function usePeople(enabled = true) {
  return useQuery<RoomPerson[], ApiRequestError>({
    queryKey: queryKeys.rooms.people,
    queryFn: roomsService.listPeople,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** One request for the whole room screen: members, pinned case + precedents, case options, latest messages. */
export function useRoom(departmentId: string | null) {
  return useQuery<RoomView, ApiRequestError>({
    queryKey: queryKeys.rooms.room(departmentId ?? ""),
    queryFn: () => roomsService.getRoom(departmentId!),
    enabled: departmentId !== null,
    refetchInterval: (query) => (query.state.data?.my_access_request ? 8_000 : false),
  });
}

function lastConfirmedSeq(view: RoomView): number {
  return view.messages.reduce((max, m) => (m.pending ? max : Math.max(max, m.seq)), 0);
}

/** Dedupes by id (a confirmed copy replaces its optimistic twin) and keeps pending messages last. */
export function mergeMessages<M extends ChatMessage, V extends { messages: M[] }>(view: V, incoming: M[]): V {
  const byId = new Map(view.messages.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  const messages = [...byId.values()].sort((a, b) => (a.pending ? Infinity : a.seq) - (b.pending ? Infinity : b.seq));
  return { ...view, messages };
}

function updateRoom(client: QueryClient, departmentId: string, update: (view: RoomView) => RoomView) {
  client.setQueryData<RoomView>(queryKeys.rooms.room(departmentId), (old) => old && update(old));
}

/** Polls for messages newer than the last one on screen and merges them into the room view. */
export function useRoomPolling(departmentId: string | null, enabled: boolean, live = false) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.rooms.poll(departmentId ?? ""),
    queryFn: async () => {
      const view = queryClient.getQueryData<RoomView>(queryKeys.rooms.room(departmentId!));
      if (!view) return 0;
      const incoming = await roomsService.getMessagesAfter(departmentId!, lastConfirmedSeq(view));
      if (incoming.length) updateRoom(queryClient, departmentId!, (current) => mergeMessages(current, incoming));
      return incoming.length;
    },
    enabled: enabled && departmentId !== null,
    refetchInterval: live ? FALLBACK_POLL_MS : POLL_MS,
    refetchIntervalInBackground: false,
  });
}

interface SendVariables {
  input: SendMessageInput;
  author: RoomPerson;
}

/** Optimistic send: the message appears at once (dimmed) and is reconciled by its client-generated id. */
export function useSendMessage(departmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.rooms.room(departmentId);

  return useMutation<RoomMessage, ApiRequestError, SendVariables>({
    mutationFn: ({ input }) => roomsService.sendMessage(departmentId, input),
    scope: { id: `room-send:${departmentId}` },
    retry: retryTransient,
    onMutate: async ({ input, author }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const optimistic: RoomMessage = {
        ...input,
        seq: 0,
        department_id: departmentId,
        author,
        tagged_case_codes: [],
        attached_artifact: null,
        created_at: new Date().toISOString(),
        pending: true,
      };
      updateRoom(queryClient, departmentId, (view) => mergeMessages(view, [optimistic]));
    },
    onError: (_error, { input }) => {
      updateRoom(queryClient, departmentId, (view) => ({
        ...view,
        messages: view.messages.filter((m) => m.id !== input.id),
      }));
    },
    onSuccess: (message) => {
      updateRoom(queryClient, departmentId, (view) => ({
        ...mergeMessages(view, [message]),
        last_read_seq: Math.max(view.last_read_seq, message.seq),
      }));
    },
    onSettled: () => {
      // Posting joins the room; refresh membership and room list counts.
      if (queryClient.getQueryData<RoomView>(key)?.is_member === false)
        queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list });
    },
  });
}

export function useMarkRead(departmentId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiRequestError, number>({
    mutationFn: (seq) => roomsService.markRead(departmentId, seq),
    retry: retryTransient,
    onMutate: (seq) => {
      updateRoom(queryClient, departmentId, (view) => ({ ...view, last_read_seq: Math.max(view.last_read_seq, seq) }));
      queryClient.setQueryData<RoomSummary[]>(queryKeys.rooms.list, (rooms) =>
        rooms?.map((r) => (r.department_id === departmentId ? { ...r, unread_count: 0 } : r)),
      );
    },
  });
}

type MemberChange = { kind: "add"; person: RoomPerson } | { kind: "remove"; userId: string };

/** Add or remove a member, optimistically. Explicit-state PUT/DELETE, so retries are safe. */
export function useChangeMember(departmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.rooms.room(departmentId);
  const mutationKey = ["rooms", "members", departmentId];

  return useMutation<void, ApiRequestError, MemberChange, { previous?: RoomView }>({
    mutationKey,
    mutationFn: (change) =>
      change.kind === "add"
        ? roomsService.addMember(departmentId, change.person.id)
        : roomsService.removeMember(departmentId, change.userId),
    scope: { id: `room-members:${departmentId}` },
    retry: retryTransient,
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RoomView>(key);
      updateRoom(queryClient, departmentId, (view) => {
        const others = view.members.filter(
          (m) => m.user.id !== (change.kind === "add" ? change.person.id : change.userId),
        );
        const members =
          change.kind === "add"
            ? [...others, { user: change.person, role: "MEMBER" as const, joined_at: new Date().toISOString() }]
            : others;
        return { ...view, members };
      });
      return { previous };
    },
    onError: (_error, _change, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData(key, snapshot.previous);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) === 1) {
        queryClient.invalidateQueries({ queryKey: key });
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list });
      }
    },
  });
}

/** Not optimistic: the precedents for the pinned case come from the server. */
export function useSetPinnedCase(departmentId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiRequestError, string | null>({
    mutationFn: (caseId) => roomsService.setPinnedCase(departmentId, caseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms.room(departmentId) }),
  });
}

interface SocketHandlers {
  onMessage: (message: ChatMessage) => void;
  onChanged: (reason: "members" | "pinned_case" | "threads") => void;
}

/**
 * Live connection to one PartyServer room: a department war room (room id = department id) or a case thread
 * (`case-<id>`). Delivers new messages and changes to the handlers, plus who's online and who's typing.
 * Polling keeps running as a fallback.
 */
export function useRoomSocket(socketRoomId: string | null, me: Presence | undefined, handlers: SocketHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const [status, setStatus] = useState<SocketStatus>("offline");
  const [online, setOnline] = useState<Presence[]>([]);
  const [typing, setTyping] = useState<Record<string, { user: Presence; until: number }>>({});
  const connection = useRef<RoomConnection | null>(null);
  const lastTypingSent = useRef(0);
  const meId = me?.id;
  const meName = me?.name;
  const meInitials = me?.avatar_initials;

  useEffect(() => {
    if (!socketRoomId || !meId || !meName || !meInitials) return;
    const self = { id: meId, name: meName, avatar_initials: meInitials };
    connection.current = connectRoom(socketRoomId, self, {
      onStatus: setStatus,
      onEvent: (event) => {
        if (event.type === "ready" || event.type === "presence") setOnline(event.presence);
        else if (event.type === "typing") {
          setTyping((current) => ({
            ...current,
            [event.user.id]: { user: event.user, until: Date.now() + TYPING_VISIBLE_MS },
          }));
        } else if (event.type === "message.created") {
          handlersRef.current.onMessage(event.message);
          const authorId = event.message.author?.id;
          setTyping((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== authorId)));
        } else if (event.type === "room.changed") {
          handlersRef.current.onChanged(event.reason);
        }
      },
    });
    return () => {
      connection.current?.close();
      connection.current = null;
      setOnline([]);
      setTyping({});
      setStatus("offline");
    };
  }, [socketRoomId, meId, meName, meInitials]);

  // Expire typing indicators.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, t]) => t.until > now)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [typing]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    connection.current?.sendTyping();
  }, []);

  return { status, online, typing: Object.values(typing).map((t) => t.user), notifyTyping };
}

/** Socket handlers that keep a department room's cache current. */
export function useRoomCacheHandlers(departmentId: string | null): SocketHandlers {
  const queryClient = useQueryClient();
  return {
    onMessage: (message) => {
      if (departmentId) updateRoom(queryClient, departmentId, (view) => mergeMessages(view, [message as RoomMessage]));
    },
    onChanged: () => {
      if (departmentId) queryClient.invalidateQueries({ queryKey: queryKeys.rooms.room(departmentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list });
    },
  };
}

export function useRequestRoomAccess(departmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.rooms.room(departmentId);
  return useMutation<AccessRequest, ApiRequestError, RoomPerson>({
    mutationFn: () => roomsService.requestAccess(departmentId),
    retry: retryTransient,
    onMutate: (me) =>
      updateRoom(queryClient, departmentId, (view) => ({
        ...view,
        my_access_request: { id: "pending", user: me, status: "PENDING", created_at: new Date().toISOString() },
      })),
    onError: () => updateRoom(queryClient, departmentId, (view) => ({ ...view, my_access_request: null })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useDecideRoomAccess(departmentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.rooms.room(departmentId);
  return useMutation<void, ApiRequestError, { requestId: string; approve: boolean }, { previous?: RoomView }>({
    mutationFn: ({ requestId, approve }) => roomsService.decideAccess(departmentId, requestId, approve),
    retry: retryTransient,
    onMutate: async ({ requestId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RoomView>(key);
      updateRoom(queryClient, departmentId, (view) => ({
        ...view,
        access_requests: (view.access_requests ?? []).filter((r) => r.id !== requestId),
      }));
      return { previous };
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData(key, snapshot.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list });
    },
  });
}
