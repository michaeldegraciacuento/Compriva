import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/lib/api";

/**
 * Puts server validation errors (VALIDATION_FAILED → details.fields) on the
 * matching form fields and returns a message for everything else.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "Something went wrong.";
  }

  const unmatched: string[] = [];
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    if ((fields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: "server", message: messages[0] });
    } else {
      unmatched.push(...messages);
    }
  }

  if (error.code === "VALIDATION_FAILED" && unmatched.length === 0) return null;
  return unmatched[0] ?? error.message;
}
