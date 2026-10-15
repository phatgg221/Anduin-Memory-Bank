export const DEFAULT_SIGNED_IN_PATH = "/workbench";
export const AUTH_PAGES = ["/login", "/register"];

const PROBE_ORIGIN = "http://dejavu.invalid";


export function safeNextPath(raw: string | null | undefined, fallback = DEFAULT_SIGNED_IN_PATH): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  if (AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
