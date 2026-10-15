import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/apiError";
import { authService } from "@/services/authService";
import type { LoginInput, RegisterInput, Session } from "@/types/auth";
import type { Department } from "@/types/org";
import { queryKeys } from "./queryKeys";

/** The signed-in user, or null when signed out. Restored once per page load from the refresh cookie. */
export function useSession() {
  return useQuery<Session | null, ApiRequestError>({
    queryKey: queryKeys.auth.session,
    queryFn: authService.restoreSession,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<Session, ApiRequestError, LoginInput>({
    mutationFn: authService.login,
    onSuccess: (session) => queryClient.setQueryData(queryKeys.auth.session, session),
  });
}

export function useSignupDepartments() {
  return useQuery<Department[], ApiRequestError>({
    queryKey: queryKeys.auth.signupDepartments,
    queryFn: authService.listSignupDepartments,
    staleTime: Infinity,
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation<Session, ApiRequestError, RegisterInput>({
    mutationFn: authService.register,
    onSuccess: (session) => queryClient.setQueryData(queryKeys.auth.session, session),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiRequestError>({
    mutationFn: authService.logout,
    onSettled: () => {
      // Drop every user-scoped cache, then mark the session as signed out.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      queryClient.setQueryData(queryKeys.auth.session, null);
    },
  });
}
