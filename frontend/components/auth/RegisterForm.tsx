"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { RegisterInput } from "@/types/auth";
import { FormAlert } from "./FormAlert";

const MIN_PASSWORD = 8;

interface RegisterFormProps {
  onSubmit: (input: RegisterInput) => void;
  isSubmitting: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export function RegisterForm({ onSubmit, isSubmitting, error, fieldErrors = {} }: RegisterFormProps) {
  const [values, setValues] = useState<RegisterInput>({ name: "", email: "", password: "", confirm_password: "" });
  const [touched, setTouched] = useState(false);

  const set = (field: keyof RegisterInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  // Client-side checks mirror the API's rules; the server re-validates everything.
  const local: Partial<Record<keyof RegisterInput, string>> = {};
  if (!values.name.trim()) local.name = "Enter your name.";
  if (!values.email.trim()) local.email = "Enter your work email.";
  if (values.password.length < MIN_PASSWORD) local.password = `Use at least ${MIN_PASSWORD} characters.`;
  if (values.confirm_password !== values.password) local.confirm_password = "Passwords do not match.";

  const errorFor = (field: keyof RegisterInput) => fieldErrors[field] ?? (touched ? local[field] : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(local).length > 0) return;
    onSubmit({ ...values, name: values.name.trim(), email: values.email.trim() });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel index={1} as="h1">
          Create account
        </SectionLabel>
        <p className="text-sm text-muted-foreground">Recall every past project from day one.</p>
      </div>

      <FieldGroup>
        <Field data-invalid={!!errorFor("name")}>
          <FieldLabel htmlFor="name">Full name</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            value={values.name}
            onChange={set("name")}
            aria-invalid={!!errorFor("name")}
          />
          <FieldError>{errorFor("name")}</FieldError>
        </Field>
        <Field data-invalid={!!errorFor("email")}>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            aria-invalid={!!errorFor("email")}
          />
          <FieldError>{errorFor("email")}</FieldError>
        </Field>
        <Field data-invalid={!!errorFor("password")}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={set("password")}
            aria-invalid={!!errorFor("password")}
          />
          {errorFor("password") ? (
            <FieldError>{errorFor("password")}</FieldError>
          ) : (
            <FieldDescription>At least {MIN_PASSWORD} characters.</FieldDescription>
          )}
        </Field>
        <Field data-invalid={!!errorFor("confirm_password")}>
          <FieldLabel htmlFor="confirm_password">Confirm password</FieldLabel>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            value={values.confirm_password}
            onChange={set("confirm_password")}
            aria-invalid={!!errorFor("confirm_password")}
          />
          <FieldError>{errorFor("confirm_password")}</FieldError>
        </Field>
      </FieldGroup>

      <FormAlert message={error} />

      <div className="flex flex-col gap-4">
        <ActionButton type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Creating account…" : "Create account"}
        </ActionButton>
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
