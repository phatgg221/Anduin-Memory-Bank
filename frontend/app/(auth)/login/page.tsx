"use client";

import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/safeRedirect";
import { useLogin } from "@/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();

  return (
    <LoginForm
      onSubmit={(input) =>
        login.mutate(input, {
          // proxy.ts sends signed-out visitors here with ?next=<where they were going>.
          onSuccess: () => router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next"))),
        })
      }
      isSubmitting={login.isPending || login.isSuccess}
      error={login.error?.message}
      fieldErrors={login.error?.fieldErrors}
    />
  );
}
