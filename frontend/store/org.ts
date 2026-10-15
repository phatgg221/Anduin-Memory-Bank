import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { retryTransient, type ApiRequestError } from "@/lib/apiError";
import { orgService } from "@/services/orgService";
import type { Session, User } from "@/types/auth";
import type { Department } from "@/types/org";
import { queryKeys } from "./queryKeys";

export function useDepartments(enabled = true) {
  return useQuery<Department[], ApiRequestError>({
    queryKey: queryKeys.org.departments,
    queryFn: orgService.listDepartments,
    staleTime: Infinity,
    enabled,
  });
}

const SWITCH_KEY = ["org", "active-department"];

/** Switch the department view. Optimistic: the header and every filtered screen change before the API answers. */
export function useSetActiveDepartment() {
  const queryClient = useQueryClient();
  const key = queryKeys.auth.session;

  return useMutation<User, ApiRequestError, string | null, { previous?: Session | null }>({
    mutationKey: SWITCH_KEY,
    mutationFn: orgService.setActiveDepartment,
    scope: { id: "active-department" },
    retry: retryTransient,
    onMutate: async (departmentId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Session | null>(key);
      queryClient.setQueryData<Session | null>(
        key,
        (old) => old && { user: { ...old.user, active_department_id: departmentId } },
      );
      return { previous };
    },
    onError: (_error, _departmentId, snapshot) => {
      if (snapshot?.previous !== undefined) queryClient.setQueryData(key, snapshot.previous);
    },
    onSuccess: (user) => {
      // The session is restored once per load (staleTime: Infinity), so reconcile from the response, not a refetch.
      if (queryClient.isMutating({ mutationKey: SWITCH_KEY }) === 1) {
        queryClient.setQueryData<Session | null>(key, (old) => old && { user });
      }
    },
  });
}
