"use client";

import { useRouter } from "next/navigation";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { safeNextPath } from "@/lib/safeRedirect";
import { useRegister } from "@/store/auth";

// Registering also signs the user in.
export default function RegisterPage() {
  const router = useRouter();
  const register = useRegister();

  return (
    <RegisterForm
      onSubmit={(input) =>
        register.mutate(input, {
          onSuccess: () => router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next"))),
        })
      }
      isSubmitting={register.isPending || register.isSuccess}
      error={register.error?.message}
      fieldErrors={register.error?.fieldErrors}
    />
  );
}
