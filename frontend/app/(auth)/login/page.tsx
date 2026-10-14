"use client";

import { LoginForm } from "@/components/auth/LoginForm";
import { useLogin } from "@/store/auth";

// On success the session cache is set, and the (auth) layout redirects to /workbench.
export default function LoginPage() {
  const login = useLogin();

  return (
    <LoginForm
      onSubmit={(input) => login.mutate(input)}
      isSubmitting={login.isPending}
      error={login.error?.message}
      fieldErrors={login.error?.fieldErrors}
    />
  );
}
