"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { applyApiError } from "@/lib/form-errors";

/**
 * A form in a dialog: validates with the given react-hook-form instance,
 * maps server field errors back onto the fields, shows other errors inline,
 * and closes (and resets) on success.
 */
export function DialogForm<T extends FieldValues>({ trigger, title, description, submitLabel, form, fields, onSubmit, children, wide = false }: {
  trigger: ReactElement;
  title: string;
  description?: string;
  submitLabel: string;
  form: UseFormReturn<T>;
  /** Field names that server validation errors may target. */
  fields: readonly Path<T>[];
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      await onSubmit(values);
      setOpen(false);
      form.reset();
    } catch (error) {
      setMessage(applyApiError(error, form.setError, fields));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setMessage(null);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className={wide ? "sm:max-w-xl" : "sm:max-w-md"}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {message && (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {children}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
