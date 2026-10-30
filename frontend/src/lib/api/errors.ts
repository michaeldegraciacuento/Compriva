import { isAxiosError } from "axios";

import {
  API_ERROR_CODES,
  type ApiErrorBody,
  type ApiErrorCode,
  type ValidationErrorDetails,
} from "@/types/api";

/** Client-side failure codes that never come from the server. */
export type ClientErrorCode = "NETWORK_ERROR" | "TIMEOUT" | "INVALID_RESPONSE";

/**
 * The only error type API calls throw. UI code branches on `code`
 * (docs/error-handling.md) and shows `message` to the user.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly status: number | null;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: {
    code: ApiErrorCode | ClientErrorCode;
    message: string;
    status?: number | null;
    details?: Record<string, unknown>;
    requestId?: string | null;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status ?? null;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  /** True when the server could not be reached; offline-capable flows fall back to local data. */
  get isOffline(): boolean {
    return this.code === "NETWORK_ERROR" || this.code === "TIMEOUT";
  }

  /** True when retrying the same request later may succeed. */
  get isRetryable(): boolean {
    return (
      this.isOffline ||
      this.code === "TOO_MANY_REQUESTS" ||
      this.code === "SERVICE_UNAVAILABLE" ||
      (this.status !== null && this.status >= 500)
    );
  }

  /** Field errors of a VALIDATION_FAILED response, keyed by field name. */
  get fieldErrors(): Record<string, string[]> {
    if (this.code !== "VALIDATION_FAILED") return {};
    return (this.details as Partial<ValidationErrorDetails>).fields ?? {};
  }
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const error = (body as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isKnownCode(code: string): code is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(code);
}

/** Converts anything thrown by axios (or our own code) into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (!isAxiosError(error)) {
    return new ApiError({
      code: "INVALID_RESPONSE",
      message: error instanceof Error ? error.message : "Unexpected error.",
      cause: error,
    });
  }

  const requestHeader = error.config?.headers?.["X-Request-Id"];
  const sentRequestId = typeof requestHeader === "string" ? requestHeader : null;

  if (!error.response) {
    const timedOut = error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
    return new ApiError({
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      message: timedOut
        ? "The server took too long to respond."
        : "Cannot reach the Compriva server. Check the internet connection.",
      requestId: sentRequestId,
      cause: error,
    });
  }

  const { status, data, headers } = error.response;
  const responseRequestId = headers?.["x-request-id"];

  if (isApiErrorBody(data)) {
    return new ApiError({
      code: isKnownCode(data.error.code) ? data.error.code : status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST",
      message: data.error.message,
      status,
      details: data.error.details ?? {},
      requestId: data.error.request_id ?? sentRequestId,
      cause: error,
    });
  }

  // Not our envelope: proxy/gateway error page, misconfigured API URL, etc.
  return new ApiError({
    code: status >= 500 ? "SERVER_ERROR" : "INVALID_RESPONSE",
    message: `Unexpected response from the server (HTTP ${status}).`,
    status,
    requestId: typeof responseRequestId === "string" ? responseRequestId : sentRequestId,
    cause: error,
  });
}
