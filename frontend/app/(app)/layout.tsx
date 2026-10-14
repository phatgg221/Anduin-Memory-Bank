"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { SessionSplash } from "@/components/auth/SessionSplash";
import { RoutedTopNav } from "@/components/shell/RoutedTopNav";
import { TopNav, type NavItem } from "@/components/shell/TopNav";
import { UserMenu } from "@/components/shell/UserMenu";
import { useLogout, useSession } from "@/store/auth";

const NAV: NavItem[] = [
  { href: "/workbench", label: "Workbench" },
  { href: "/vault", label: "Knowledge Vault", disabled: true },
  { href: "/ingest", label: "Ingest Archive", disabled: true },
];

/**
 * Signed-in area. The session is restored in the browser (the refresh cookie is scoped to /api/auth, so page
 * requests never carry it); signed-out visitors are sent to /login.
 *
 * Pages always render — hidden behind the splash until the session is known — so the route keeps a complete
 * static shell (Cache Components' instant-navigation validation flags segments a layout doesn't render). Hiding
 * them is a UX choice, not security: every API call still requires a valid access token.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const user = session.data?.user;
  const signedOut = session.isSuccess && session.data === null;

  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  const userMenu = user && (
    <UserMenu name={user.name} email={user.email} onSignOut={() => logout.mutate()} isSigningOut={logout.isPending} />
  );

  return (
    <>
      {/* usePathname suspends on dynamic routes: keep a static nav as the fallback. */}
      <Suspense fallback={<TopNav items={NAV} actions={userMenu} />}>
        <RoutedTopNav items={NAV} actions={userMenu} />
      </Suspense>
      <main className="flex flex-1 flex-col">
        {!user && <SessionSplash error={session.error?.message} />}
        <div hidden={!user} className="flex flex-1 flex-col">
          {children}
        </div>
      </main>
    </>
  );
}
