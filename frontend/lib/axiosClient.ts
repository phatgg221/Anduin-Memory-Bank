import axios, { type AxiosError } from "axios";
import type { AuthResponse } from "@/types/auth";
import { accessTokenStore } from "./accessToken";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Don't run the 401 → refresh → retry flow (the auth endpoints themselves). */
    skipAuthRefresh?: boolean;
    /** Set on the single retry after a refresh, so a second 401 isn't retried again. */
    authRetried?: boolean;
  }
}

// Relative base URL: browser-only. Never call services from Server Components.
export const axiosClient = axios.create({ baseURL: "/api", timeout: 30_000 });

axiosClient.interceptors.request.use((config) => {
  const token = accessTokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let inflightRefresh: Promise<AuthResponse> | null = null;

/** Trade the httpOnly refresh cookie for a fresh access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse> {
  inflightRefresh ??= requestRefresh().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

async function requestRefresh(retryOnRace = true): Promise<AuthResponse> {
  try {
    const { data } = await axiosClient.post<AuthResponse>("/auth/refresh", null, { skipAuthRefresh: true });
    accessTokenStore.set(data.access_token);
    return data;
  } catch (error) {
    // 409: another tab rotated the cookie a moment ago. The browser already holds the new one, so retry once.
    if (retryOnRace && axios.isAxiosError(error) && error.response?.status === 409) return requestRefresh(false);
    throw error;
  }
}

// Access token expired → refresh once → replay the original request.
axiosClient.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config;
  if (error.response?.status !== 401 || !config || config.skipAuthRefresh || config.authRetried) throw error;

  try {
    await refreshSession();
  } catch (refreshError) {
    // Only a rejected refresh ends the session; a network blip shouldn't sign the user out.
    if (axios.isAxiosError(refreshError) && refreshError.response?.status === 401) accessTokenStore.expire();
    throw error;
  }
  return axiosClient({ ...config, authRetried: true });
});
