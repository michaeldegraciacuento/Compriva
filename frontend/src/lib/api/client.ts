import axios, { type AxiosRequestConfig } from "axios";

import { uuidv7 } from "@/lib/ids";
import type { AuthMode } from "@/platform/types";
import type { ApiEnvelope } from "@/types/api";

import { ApiError, toApiError } from "./errors";

export interface ApiClientOptions {
  /** API origin, e.g. http://localhost:8000 (no /api/v1). */
  baseUrl: string;
  authMode: AuthMode;
  /** Bearer token provider (desktop). */
  getAccessToken?: () => Promise<string | null>;
  /** Device install ID provider (desktop); sent as X-Compriva-Device. */
  getDeviceId?: () => Promise<string | null>;
  timeoutMs?: number;
  /** Called when the server says the session/token is no longer valid (401 UNAUTHENTICATED). */
  onUnauthenticated?: (error: ApiError) => void;
  /** For tests: replaces the HTTP transport. */
  adapter?: AxiosRequestConfig["adapter"];
}

export interface ApiRequestConfig extends Omit<AxiosRequestConfig, "url" | "method" | "data"> {
  /**
   * Sent as Idempotency-Key. Required for writes that may be retried
   * (every terminal operation); the server applies a given key only once.
   */
  idempotencyKey?: string;
  /**
   * Overrides the platform's token for this request, e.g. terminal endpoints
   * that need the device token while a cashier is signed in.
   */
  bearerToken?: string;
}

export interface ApiClient {
  /** Full envelope ({ data, meta }) — use for paginated lists. */
  request<T, M = Record<string, unknown>>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    config?: ApiRequestConfig,
  ): Promise<ApiEnvelope<T, M>>;
  get<T>(path: string, config?: ApiRequestConfig): Promise<T>;
  post<T>(path: string, body?: unknown, config?: ApiRequestConfig): Promise<T>;
  put<T>(path: string, body?: unknown, config?: ApiRequestConfig): Promise<T>;
  patch<T>(path: string, body?: unknown, config?: ApiRequestConfig): Promise<T>;
  delete<T = void>(path: string, config?: ApiRequestConfig): Promise<T>;
  /** Web (cookie mode) only: fetches the CSRF cookie before the first state-changing request. */
  ensureCsrfCookie(): Promise<void>;
  /** GET a file (report export): the bytes and the server's file name. Errors are ApiErrors as usual. */
  download(path: string, config?: ApiRequestConfig): Promise<{ blob: Blob; filename: string | null }>;
}

export const API_PREFIX = "/api/v1";

export function createApiClient(options: ApiClientOptions): ApiClient {
  const cookieMode = options.authMode === "cookie";

  const http = axios.create({
    baseURL: `${options.baseUrl}${API_PREFIX}`,
    timeout: options.timeoutMs ?? 15_000,
    headers: { Accept: "application/json" },
    withCredentials: cookieMode,
    withXSRFToken: cookieMode,
    adapter: options.adapter,
  });

  http.interceptors.request.use(async (config) => {
    config.headers.set("X-Request-Id", uuidv7());

    if (!cookieMode && !config.headers.has("Authorization")) {
      const token = await options.getAccessToken?.();
      if (token) config.headers.set("Authorization", `Bearer ${token}`);
    }

    const deviceId = await options.getDeviceId?.();
    if (deviceId) config.headers.set("X-Compriva-Device", deviceId);

    return config;
  });

  async function request<T, M>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    config: ApiRequestConfig = {},
  ): Promise<ApiEnvelope<T, M>> {
    const { idempotencyKey, bearerToken, headers, ...rest } = config;
    try {
      const response = await http.request({
        ...rest,
        method,
        url: path,
        data: body,
        headers: {
          ...(headers as Record<string, string> | undefined),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
      });

      if (response.status === 204) return { data: undefined as T };

      const envelope = response.data as unknown;
      if (typeof envelope !== "object" || envelope === null || !("data" in envelope)) {
        throw new ApiError({
          code: "INVALID_RESPONSE",
          message: "The server response is not in the expected format.",
          status: response.status,
        });
      }
      return envelope as ApiEnvelope<T, M>;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === "UNAUTHENTICATED") options.onUnauthenticated?.(apiError);
      throw apiError;
    }
  }

  async function data<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    config?: ApiRequestConfig,
  ): Promise<T> {
    return (await request<T, unknown>(method, path, body, config)).data;
  }

  async function download(path: string, config: ApiRequestConfig = {}): Promise<{ blob: Blob; filename: string | null }> {
    try {
      const response = await http.request<Blob>({ timeout: 120_000, ...config, method: "GET", url: path, responseType: "blob" });
      const disposition = String(response.headers["content-disposition"] ?? "");
      return { blob: response.data, filename: /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? null };
    } catch (error) {
      // Error bodies arrive as a Blob too: read the JSON envelope so the usual error mapping applies.
      const body = (error as { response?: { data?: unknown } }).response?.data;
      if (body instanceof Blob) {
        try {
          (error as { response: { data: unknown } }).response.data = JSON.parse(await body.text());
        } catch {
          // not JSON: leave it to toApiError
        }
      }
      const apiError = toApiError(error);
      if (apiError.code === "UNAUTHENTICATED") options.onUnauthenticated?.(apiError);
      throw apiError;
    }
  }

  let csrfReady: Promise<void> | null = null;

  return {
    request,
    get: <T>(path: string, config?: ApiRequestConfig) => data<T>("GET", path, undefined, config),
    post: <T>(path: string, body?: unknown, config?: ApiRequestConfig) => data<T>("POST", path, body, config),
    put: <T>(path: string, body?: unknown, config?: ApiRequestConfig) => data<T>("PUT", path, body, config),
    patch: <T>(path: string, body?: unknown, config?: ApiRequestConfig) => data<T>("PATCH", path, body, config),
    delete: <T = void>(path: string, config?: ApiRequestConfig) => data<T>("DELETE", path, undefined, config),
    download,
    ensureCsrfCookie() {
      if (!cookieMode) return Promise.resolve();
      csrfReady ??= http
        .get(`${options.baseUrl}/sanctum/csrf-cookie`, { baseURL: "" })
        .then(() => undefined)
        .catch((error: unknown) => {
          csrfReady = null;
          throw toApiError(error);
        });
      return csrfReady;
    },
  };
}
