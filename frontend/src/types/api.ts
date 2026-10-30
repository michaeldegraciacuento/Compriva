/**
 * Wire format of the Compriva API (docs/api-conventions.md).
 * Field names mirror the API exactly (snake_case); there is no case conversion layer.
 */

/** Successful response body. */
export interface ApiEnvelope<T, M = Record<string, unknown>> {
  data: T;
  meta?: M;
}

/** `meta` of paginated list endpoints (Laravel resource collections). */
export interface PaginationMeta {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number | null;
  to: number | null;
}

export type Paginated<T> = ApiEnvelope<T[], PaginationMeta>;

/** Keep in sync with backend/app/Support/Errors/ErrorCode.php. */
export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "SESSION_EXPIRED",
  "TOO_MANY_REQUESTS",
  "INVALID_CREDENTIALS",
  "ACCOUNT_SUSPENDED",
  "PAIRING_CODE_INVALID",
  "BUSINESS_RULE_VIOLATION",
  "INSUFFICIENT_STOCK",
  "TERMINAL_REQUIRED",
  "SHIFT_REQUIRED",
  "APPROVAL_REQUIRED",
  "TOTAL_MISMATCH",
  "DEVICE_NOT_REGISTERED",
  "DEVICE_REVOKED",
  "DUPLICATE_OPERATION",
  "SYNC_CURSOR_INVALID",
  "SERVICE_UNAVAILABLE",
  "SERVER_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Error response body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: Record<string, unknown>;
    request_id: string | null;
  };
}

/** `details` of a VALIDATION_FAILED error. */
export interface ValidationErrorDetails {
  fields: Record<string, string[]>;
}
