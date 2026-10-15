"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ActionButton } from "@/components/brand/ActionButton";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RegisterInput } from "@/types/auth";
import type { Department } from "@/types/org";
import { FormAlert } from "./FormAlert";

const MIN_PASSWORD = 8;
const ROLE_SUGGESTIONS = [
  "Customer Success Lead",
  "Client Operations Specialist",
  "Fund Onboarding Manager",
  "Legal Counsel",
  "Compliance Analyst",
  "Solutions Architect",
  "Solutions Engineer",
  "Site Reliability Engineer",
];

interface RegisterFormProps {
  onSubmit: (input: RegisterInput) => void;
  departments: Department[];
  isSubmitting: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export function RegisterForm({ onSubmit, departments, isSubmitting, error, fieldErrors = {} }: RegisterFormProps) {
  const [values, setValues] = useState<RegisterInput>({
    name: "",
    email: "",
    password: "",
    confirm_password: "",
    job_title: "",
    department_id: "",
  });
  const [touched, setTouched] = useState(false);

  const set = (field: keyof RegisterInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  // Client-side checks mirror the API's rules; the server re-validates everything.
  const local: Partial<Record<keyof RegisterInput, string>> = {};
  if (!values.name.trim()) local.name = "Enter your name.";
  if (!values.email.trim()) local.email = "Enter your work email.";
  if (values.job_title.trim().length < 2) local.job_title = "Enter your role, e.g. Legal Counsel.";
  if (!values.department_id) local.department_id = "Choose your department.";
  if (values.password.length < MIN_PASSWORD) local.password = `Use at least ${MIN_PASSWORD} characters.`;
  if (values.confirm_password !== values.password) local.confirm_password = "Passwords do not match.";

  const errorFor = (field: keyof RegisterInput) => fieldErrors[field] ?? (touched ? local[field] : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(local).length > 0) return;
    onSubmit({ ...values, name: values.name.trim(), email: values.email.trim(), job_title: values.job_title.trim() });
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
        <Field data-invalid={!!errorFor("job_title")}>
          <FieldLabel htmlFor="job_title">Role</FieldLabel>
          <Input
            id="job_title"
            list="job-title-options"
            autoComplete="organization-title"
            placeholder="e.g. Customer Success Lead"
            value={values.job_title}
            onChange={set("job_title")}
            aria-invalid={!!errorFor("job_title")}
          />
          <datalist id="job-title-options">
            {ROLE_SUGGESTIONS.map((role) => (
              <option key={role} value={role} />
            ))}
          </datalist>
          <FieldError>{errorFor("job_title")}</FieldError>
        </Field>
        <Field data-invalid={!!errorFor("department_id")}>
          <FieldLabel htmlFor="department_id">Department</FieldLabel>
          <Select
            value={values.department_id}
            onValueChange={(value) => setValues((current) => ({ ...current, department_id: value }))}
          >
            <SelectTrigger id="department_id" className="w-full" aria-invalid={!!errorFor("department_id")}>
              <SelectValue placeholder={departments.length ? "Choose your department" : "Loading departments…"} />
            </SelectTrigger>
            <SelectContent>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  <span className="micro-label text-muted-foreground">{department.code}</span>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorFor("department_id") ? (
            <FieldError>{errorFor("department_id")}</FieldError>
          ) : (
            <FieldDescription>Your workbench opens on this department. You can switch any time.</FieldDescription>
          )}
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
