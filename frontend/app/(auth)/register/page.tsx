"use client";

import { RegisterForm } from "@/components/auth/RegisterForm";
import { useRegister } from "@/store/auth";

// Registering also signs the user in; the (auth) layout then redirects to /workbench.
export default function RegisterPage() {
  const register = useRegister();

  return (
    <RegisterForm
      onSubmit={(input) => register.mutate(input)}
      isSubmitting={register.isPending}
      error={register.error?.message}
      fieldErrors={register.error?.fieldErrors}
    />
  );
}
