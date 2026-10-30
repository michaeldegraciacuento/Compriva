import type { ComponentProps, ReactNode } from "react";

import { NativeSelect } from "@/components/native-select";
import { Label } from "@/components/ui/label";

/** Labelled native select with an accessible error message (pairs with FormField). */
export function SelectField({ id, label, error, hint, children, ...select }: ComponentProps<"select"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...select}>
        {children}
      </NativeSelect>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
