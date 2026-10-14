import { NextResponse, type NextRequest } from "next/server";
import { AUTH_PAGES, DEFAULT_SIGNED_IN_PATH, safeNextPath } from "@/lib/safeRedirect";
import { REFRESH_COOKIE, verifyRefreshToken } from "@/lib/sessionCookie";


export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const token = request.cookies.get(REFRESH_COOKIE)?.value;
  const session = await verifyRefreshToken(token);
  const isAuthPage = AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));

  if (isAuthPage) {
    return session
      ? NextResponse.redirect(new URL(safeNextPath(searchParams.get("next")), request.url))
      : NextResponse.next();
  }

  if (!session) {
    const login = new URL("/login", request.url);
    if (pathname !== DEFAULT_SIGNED_IN_PATH || search) login.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(login);
    if (token) response.cookies.delete({ name: REFRESH_COOKIE, path: "/" });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/|__nextjs|.*\\.[a-zA-Z0-9]+$).*)"],
};
