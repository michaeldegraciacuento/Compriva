"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { applyApiError } from "@/lib/form-errors";
import { notify } from "@/lib/notify";

import { changePassword, changePin } from "../api";

type Status = { kind: "success" | "error"; message: string } | null;

function StatusAlert({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <Alert variant={status.kind === "error" ? "destructive" : "default"}>
      <AlertDescription>{status.message}</AlertDescription>
    </Alert>
  );
}

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    password: z.string().min(8, "Use at least 8 characters.").regex(/[A-Za-z]/, "Include a letter.").regex(/\d/, "Include a number."),
    password_confirmation: z.string(),
  })
  .refine((v) => v.password === v.password_confirmation, { path: ["password_confirmation"], message: "Passwords do not match." });

type PasswordValues = z.infer<typeof passwordSchema>;

export function ChangePasswordForm({ disabled }: { disabled?: boolean }) {
  const [status, setStatus] = useState<Status>(null);
  const { register, handleSubmit, setError, reset, formState } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", password: "", password_confirmation: "" },
  });

  const submit = handleSubmit(async (values) => {
    setStatus(null);
    try {
      await changePassword(values);
      reset();
      setStatus(null);
      notify.success("Password changed", "You were signed out of your other sessions.");
    } catch (error) {
      const message = applyApiError(error, setError, ["current_password", "password", "password_confirmation"]);
      if (message) setStatus({ kind: "error", message });
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <StatusAlert status={status} />
      <FormField id="current_password" label="Current password" type="password" autoComplete="current-password"
        disabled={disabled} error={formState.errors.current_password?.message} {...register("current_password")} />
      <FormField id="password" label="New password" type="password" autoComplete="new-password"
        hint="At least 8 characters with letters and numbers."
        disabled={disabled} error={formState.errors.password?.message} {...register("password")} />
      <FormField id="password_confirmation" label="Confirm new password" type="password" autoComplete="new-password"
        disabled={disabled} error={formState.errors.password_confirmation?.message} {...register("password_confirmation")} />
      <Button type="submit" disabled={disabled || formState.isSubmitting} className="justify-self-start">
        Change password
      </Button>
    </form>
  );
}

const pinSchema = z
  .object({
    current_password: z.string().min(1, "Enter your password."),
    pin: z.string().regex(/^\d{6}$/, "The PIN must be exactly 6 digits."),
    pin_confirmation: z.string(),
  })
  .refine((v) => v.pin === v.pin_confirmation, { path: ["pin_confirmation"], message: "PINs do not match." });

type PinValues = z.infer<typeof pinSchema>;

export function ChangePinForm({ disabled }: { disabled?: boolean }) {
  const [status, setStatus] = useState<Status>(null);
  const { register, handleSubmit, setError, reset, formState } = useForm<PinValues>({
    resolver: zodResolver(pinSchema),
    defaultValues: { current_password: "", pin: "", pin_confirmation: "" },
  });

  const submit = handleSubmit(async (values) => {
    setStatus(null);
    try {
      await changePin(values);
      reset();
      setStatus(null);
      notify.success("PIN updated", "Terminals receive it at their next cashier-list refresh.");
    } catch (error) {
      const message = applyApiError(error, setError, ["current_password", "pin", "pin_confirmation"]);
      if (message) setStatus({ kind: "error", message });
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <StatusAlert status={status} />
      <FormField id="pin_current_password" label="Password" type="password" autoComplete="current-password"
        disabled={disabled} error={formState.errors.current_password?.message} {...register("current_password")} />
      <FormField id="pin" label="New PIN" type="password" inputMode="numeric" maxLength={6} autoComplete="off"
        hint="6 digits. Avoid repeated or sequential digits."
        disabled={disabled} error={formState.errors.pin?.message} {...register("pin")} />
      <FormField id="pin_confirmation" label="Confirm PIN" type="password" inputMode="numeric" maxLength={6} autoComplete="off"
        disabled={disabled} error={formState.errors.pin_confirmation?.message} {...register("pin_confirmation")} />
      <Button type="submit" disabled={disabled || formState.isSubmitting} className="justify-self-start">
        Set PIN
      </Button>
    </form>
  );
}
