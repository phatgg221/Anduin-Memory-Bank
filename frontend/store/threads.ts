import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { retryTransient, type ApiRequestError } from "@/lib/apiError";
import { casesService } from "@/services/casesService";
import type {
  ChatMessage,
  CreateCaseInput,
  RoomPerson,
  SendMessageInput,
  ThreadMessage,
  ThreadSummary,
  ThreadView,
  UpdateCaseInput,
} from "@/types/rooms";
import { queryKeys } from "./queryKeys";
import { mergeMessages } from "./rooms";

const POLL_MS = 3_000;
const FALLBACK_POLL_MS = 30_000;

/** One request for the whole thread screen: the case, its precedents, participants and latest messages. */
export function useThread(caseId: string | null) {
  return useQuery<ThreadView, ApiRequestError>({
    queryKey: queryKeys.cases.thread(caseId ?? ""),
    queryFn: () => casesService.getThread(caseId!),
    enabled: caseId !== null,
  });
}

function updateThread(client: QueryClient, caseId: string, update: (view: ThreadView) => ThreadView) {
  client.setQueryData<ThreadView>(queryKeys.cases.thread(caseId), (old) => old && update(old));
}

/** Polling fallback for a thread: merges messages newer than the last confirmed one. */
export function useThreadPolling(caseId: string | null, enabled: boolean, live = false) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.cases.poll(caseId ?? ""),
    queryFn: async () => {
      const view = queryClient.getQueryData<ThreadView>(queryKeys.cases.thread(caseId!));
      if (!view) return 0;
      const after = view.messages.reduce((max, m) => (m.pending ? max : Math.max(max, m.seq)), 0);
      const incoming = await casesService.getThreadMessagesAfter(caseId!, after);
      if (incoming.length) updateThread(queryClient, caseId!, (current) => mergeMessages(current, incoming));
      return incoming.length;
    },
    enabled: enabled && caseId !== null,
    refetchInterval: live ? FALLBACK_POLL_MS : POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Socket handlers that keep a thread's cache current. */
export function useThreadCacheHandlers(caseId: string | null) {
  const queryClient = useQueryClient();
  return {
    onMessage: (message: ChatMessage) => {
      if (caseId) updateThread(queryClient, caseId, (view) => mergeMessages(view, [message as ThreadMessage]));
    },
    onChanged: () => {
      if (caseId) queryClient.invalidateQueries({ queryKey: queryKeys.cases.thread(caseId) });
    },
  };
}

interface SendVariables {
  input: SendMessageInput;
  author: RoomPerson;
}

/** Optimistic send, reconciled by the client-generated id (same pattern as the war room). */
export function useSendThreadMessage(caseId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.cases.thread(caseId);

  return useMutation<ThreadMessage, ApiRequestError, SendVariables>({
    mutationFn: ({ input }) => casesService.sendThreadMessage(caseId, input),
    scope: { id: `thread-send:${caseId}` },
    retry: retryTransient,
    onMutate: async ({ input, author }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const optimistic: ThreadMessage = {
        ...input,
        seq: 0,
        case_id: caseId,
        author,
        tagged_case_codes: [],
        attached_artifact: null,
        created_at: new Date().toISOString(),
        pending: true,
      };
      updateThread(queryClient, caseId, (view) => mergeMessages(view, [optimistic]));
    },
    onError: (_error, { input }) => {
      updateThread(queryClient, caseId, (view) => ({ ...view, messages: view.messages.filter((m) => m.id !== input.id) }));
    },
    onSuccess: (message) =>
      updateThread(queryClient, caseId, (view) => {
        const merged = mergeMessages(view, [message]);
        const author = message.author;
        const known = !author || view.participants.some((p) => p.id === author.id);
        return known ? merged : { ...merged, participants: [...view.participants, author] };
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all }),
  });
}

/** Not optimistic: the server assigns the case code. Pending state while it runs. */
export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation<ThreadSummary, ApiRequestError, CreateCaseInput>({
    mutationFn: casesService.createCase,
    retry: retryTransient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all }),
  });
}

/** Edit an open case's details. Optimistic: the panel and header change at once, rolled back if the API refuses. */
export function useUpdateCase(caseId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.cases.thread(caseId);
  return useMutation<ThreadView, ApiRequestError, UpdateCaseInput, { previous?: ThreadView }>({
    mutationFn: (input) => casesService.updateCase(caseId, input),
    scope: { id: `case-edit:${caseId}` },
    retry: retryTransient,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ThreadView>(key);
      // lead_user_id can't be shown optimistically without the person; the server response fills it in.
      const visible = Object.fromEntries(Object.entries(input).filter(([k]) => k !== "lead_user_id"));
      updateThread(queryClient, caseId, (view) => ({ ...view, ...visible }));
      return { previous };
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData(key, snapshot.previous);
    },
    onSuccess: (view) => queryClient.setQueryData<ThreadView>(key, (old) => ({ ...view, messages: old?.messages ?? view.messages })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all }),
  });
}
