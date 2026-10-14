import type { ReactNode } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";

// Signed-in visitors never reach these pages: proxy.ts redirects them to the workbench (or their ?next= target).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col">
      <AuthFrame>{children}</AuthFrame>
    </main>
  );
}
