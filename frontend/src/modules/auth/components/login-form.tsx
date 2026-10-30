"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { applyApiError } from "@/lib/form-errors";

import { useAuthStore } from "../store";

const schema = z.object({
  login: z.string().trim().min(1, "Enter your username or email."),
  password: z.string().min(1, "Enter your password."),
});

type Values = z.infer<typeof schema>;

/** Sign-in with username or email + password (web and desktop). */
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const login = useAuthStore((state) => state.login);
  const [message, setMessage] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { login: "", password: "" },
  });

  const submit = handleSubmit(async (values) => {
    setMessage(null);
    try {
      await login(values.login, values.password);
      onSuccess();
    } catch (error) {
      setMessage(applyApiError(error, setError, ["login", "password"]));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <FormField id="login" label="Username or email" autoComplete="username" autoFocus
        error={formState.errors.login?.message} {...register("login")} />
      <FormField id="password" label="Password" type="password" autoComplete="current-password"
        error={formState.errors.password?.message} {...register("password")} />
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
