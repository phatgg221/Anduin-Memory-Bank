"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { SessionSplash } from "@/components/auth/SessionSplash";
import { OnboardingGuide } from "@/components/shell/OnboardingGuide";
import { DepartmentSwitcher } from "@/components/shell/DepartmentSwitcher";
import { RoutedTopNav } from "@/components/shell/RoutedTopNav";
import { TopNav, type NavItem } from "@/components/shell/TopNav";
import { UserMenu } from "@/components/shell/UserMenu";
import { useOnboarding } from "@/lib/useOnboarding";
import { useLogout, useSession } from "@/store/auth";
import { useDepartments, useSetActiveDepartment } from "@/store/org";

const NAV: NavItem[] = [
  { href: "/workbench", label: "Workbench" },
  { href: "/vault", label: "Knowledge Vault" },
  { href: "/ingest", label: "Ingest Archive" },
];

/**
 * Signed-in area. proxy.ts has already turned away visitors without a valid-looking session cookie; this gate
 * restores the session in the browser (getting an access token) and catches what the proxy can't see — a revoked
 * session — by sending the visitor to /login when /api/auth/refresh says no.
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
  const departments = useDepartments(Boolean(user));
  const setDepartment = useSetActiveDepartment();
  const onboarding = useOnboarding(user?.id);

  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  const userMenu = user && (
    <>
      {departments.data && (
        <DepartmentSwitcher
          departments={departments.data}
          activeId={user.active_department_id}
          onChange={(departmentId) => setDepartment.mutate(departmentId)}
          error={setDepartment.error?.message}
        />
      )}
      <UserMenu
        name={user.name}
        email={user.email}
        onSignOut={() => logout.mutate()}
        onShowGuide={onboarding.show}
        isSigningOut={logout.isPending}
      />
    </>
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
      {user && <OnboardingGuide open={onboarding.open} userName={user.name} onDismiss={onboarding.dismiss} />}
    </>
  );
}
