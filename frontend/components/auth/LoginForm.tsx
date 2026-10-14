"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { LoginInput } from "@/types/auth";
import { FormAlert } from "./FormAlert";

interface LoginFormProps {
  onSubmit: (input: LoginInput) => void;
  isSubmitting: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export function LoginForm({ onSubmit, isSubmitting, error, fieldErrors = {} }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ email: email.trim(), password });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel index={1} as="h1">
          Sign in
        </SectionLabel>
        <p className="text-sm text-muted-foreground">Welcome back. Pick up where the team left off.</p>
      </div>

      <FieldGroup>
        <Field data-invalid={!!fieldErrors.email}>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
          />
          <FieldError>{fieldErrors.email}</FieldError>
        </Field>
        <Field data-invalid={!!fieldErrors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
          />
          <FieldError>{fieldErrors.password}</FieldError>
        </Field>
      </FieldGroup>

      <FormAlert message={error} />

      <div className="flex flex-col gap-4">
        <ActionButton type="submit" disabled={isSubmitting || !email || !password} className="w-full">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </ActionButton>
        <p className="text-sm text-muted-foreground">
          New to Dejavu?{" "}
          <Link href="/register" className="font-medium text-ink underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </div>
    </form>
  );
}
