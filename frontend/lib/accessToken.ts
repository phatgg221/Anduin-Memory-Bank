// The access token lives only in memory, never in localStorage: injected scripts can't lift it from storage, and
// a page reload restores it by trading the httpOnly refresh cookie at /api/auth/refresh.
let accessToken: string | null = null;
const expiryListeners = new Set<() => void>();

export const accessTokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
  },
  /** Subscribe to "the session is over" (a refresh was rejected). Returns an unsubscribe function. */
  onExpired(listener: () => void): () => void {
    expiryListeners.add(listener);
    return () => {
      expiryListeners.delete(listener);
    };
  },
  expire() {
    accessToken = null;
    expiryListeners.forEach((listener) => listener());
  },
};
