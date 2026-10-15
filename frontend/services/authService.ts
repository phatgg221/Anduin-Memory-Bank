import { accessTokenStore } from "@/lib/accessToken";
import { toApiRequestError, withApiErrors } from "@/lib/apiError";
import { axiosClient, refreshSession } from "@/lib/axiosClient";
import type { AuthResponse, LoginInput, RegisterInput, Session } from "@/types/auth";
import type { Department } from "@/types/org";

// Auth endpoints opt out of the 401 → refresh flow: a 401 here means bad credentials, not an expired token.
const AUTH = { skipAuthRefresh: true } as const;

function startSession(data: AuthResponse): Session {
  accessTokenStore.set(data.access_token);
  return { user: data.user };
}

export const authService = {
  async register(input: RegisterInput): Promise<Session> {
    const { data } = await withApiErrors(axiosClient.post<AuthResponse>("/auth/register", input, AUTH));
    return startSession(data);
  },

  /** Public: the department picker on the sign-up page. */
  async listSignupDepartments(): Promise<Department[]> {
    const { data } = await withApiErrors(axiosClient.get<Department[]>("/auth/departments", AUTH));
    return data;
  },

  async login(input: LoginInput): Promise<Session> {
    const { data } = await withApiErrors(axiosClient.post<AuthResponse>("/auth/login", input, AUTH));
    return startSession(data);
  },

  async logout(): Promise<void> {
    try {
      await withApiErrors(axiosClient.post("/auth/logout", null, AUTH));
    } finally {
      accessTokenStore.set(null);
    }
  },

  /** On app load: trade the refresh cookie for an access token. Resolves to null when signed out. */
  async restoreSession(): Promise<Session | null> {
    try {
      return { user: (await refreshSession()).user };
    } catch (error) {
      const apiError = toApiRequestError(error);
      if (apiError.status === 401) return null;
      throw apiError;
    }
  },
};
