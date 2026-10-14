"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { useSession } from "@/store/auth";

/** Sign-in / register. Anyone already signed in (or who just signed in) goes to the workbench. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const signedIn = Boolean(useSession().data);

  useEffect(() => {
    if (signedIn) router.replace("/workbench");
  }, [signedIn, router]);

  return (
    <main className="flex flex-1 flex-col">
      <AuthFrame>{children}</AuthFrame>
    </main>
  );
}
