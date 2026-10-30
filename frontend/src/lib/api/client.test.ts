import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { createApiClient, type ApiClientOptions } from "./client";
import { ApiError } from "./errors";

type Reply = { status: number; data?: unknown } | { networkError: true } | { timeout: true };

/** Fake transport: records requests and answers with `reply`. */
function fakeServer(reply: Reply) {
  const requests: InternalAxiosRequestConfig[] = [];

  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    requests.push(config);

    if ("networkError" in reply) {
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config, {});
    }
    if ("timeout" in reply) {
      throw new AxiosError("timeout exceeded", AxiosError.ECONNABORTED, config, {});
    }

    const response: AxiosResponse = {
      status: reply.status,
      statusText: "",
      data: reply.data,
      headers: new AxiosHeaders(),
      config,
    };
    if (reply.status >= 400) {
      throw new AxiosError("Request failed", AxiosError.ERR_BAD_RESPONSE, config, {}, response);
    }
    return response;
  };

  return { adapter, requests };
}

function client(reply: Reply, options: Partial<ApiClientOptions> = {}) {
  const server = fakeServer(reply);
  const api = createApiClient({
    baseUrl: "http://api.test",
    authMode: "bearer",
    adapter: server.adapter,
    ...options,
  });
  return { api, requests: server.requests };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("createApiClient", () => {
  it("calls the versioned API and unwraps the data envelope", async () => {
    const { api, requests } = client({ status: 200, data: { data: { status: "ok" } } });

    await expect(api.get("/health")).resolves.toEqual({ status: "ok" });
    expect(requests[0].baseURL).toBe("http://api.test/api/v1");
    expect(requests[0].url).toBe("/health");
  });

  it("returns the full envelope from request() for paginated lists", async () => {
    const page = { data: [{ id: 1 }], meta: { current_page: 1, total: 1 } };
    const { api } = client({ status: 200, data: page });

    await expect(api.request("GET", "/products")).resolves.toEqual(page);
  });

  it("sends request ID, bearer token, device ID and idempotency key in bearer mode", async () => {
    const { api, requests } = client(
      { status: 201, data: { data: {} } },
      { getAccessToken: async () => "tok", getDeviceId: async () => "device-1" },
    );

    await api.post("/sync/operations", { a: 1 }, { idempotencyKey: "op-1" });
    const headers = requests[0].headers;

    expect(headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("X-Compriva-Device")).toBe("device-1");
    expect(headers.get("Idempotency-Key")).toBe("op-1");
    expect(requests[0].withCredentials).toBe(false);
  });

  it("uses cookies and never a bearer header in cookie mode", async () => {
    const { api, requests } = client(
      { status: 200, data: { data: null } },
      { authMode: "cookie", getAccessToken: async () => "should-not-be-sent" },
    );

    await api.get("/me");

    expect(requests[0].withCredentials).toBe(true);
    expect(requests[0].withXSRFToken).toBe(true);
    expect(requests[0].headers.get("Authorization")).toBeUndefined();
  });

  it("resolves 204 No Content to undefined", async () => {
    const { api } = client({ status: 204 });

    await expect(api.delete("/things/1")).resolves.toBeUndefined();
  });

  it("maps the error envelope to ApiError with field errors", async () => {
    const { api } = client({
      status: 422,
      data: {
        error: {
          code: "VALIDATION_FAILED",
          message: "The given data was invalid.",
          details: { fields: { name: ["The name field is required."] } },
          request_id: "req-1",
        },
      },
    });

    const error = await rejection(api.post("/products", {}));

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-1");
    expect(error.fieldErrors).toEqual({ name: ["The name field is required."] });
    expect(error.isRetryable).toBe(false);
  });

  it("reports network failures as offline and retryable", async () => {
    const { api } = client({ networkError: true });

    const error = await rejection(api.get("/health"));

    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.isOffline).toBe(true);
    expect(error.isRetryable).toBe(true);
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reports timeouts as offline", async () => {
    const { api } = client({ timeout: true });

    const error = await rejection(api.get("/health"));

    expect(error.code).toBe("TIMEOUT");
    expect(error.isOffline).toBe(true);
  });

  it("handles non-envelope gateway errors", async () => {
    const { api } = client({ status: 502, data: "<html>Bad Gateway</html>" });

    const error = await rejection(api.get("/health"));

    expect(error.code).toBe("SERVER_ERROR");
    expect(error.status).toBe(502);
    expect(error.isRetryable).toBe(true);
  });

  it("rejects successful responses that are not an envelope", async () => {
    const { api } = client({ status: 200, data: "<html>captive portal</html>" });

    const error = await rejection(api.get("/health"));

    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("does not fetch a CSRF cookie in bearer mode", async () => {
    const { api, requests } = client({ status: 204 });

    await api.ensureCsrfCookie();

    expect(requests).toHaveLength(0);
  });

  it("fetches the Sanctum CSRF cookie once in cookie mode", async () => {
    const { api, requests } = client({ status: 204 }, { authMode: "cookie" });

    await Promise.all([api.ensureCsrfCookie(), api.ensureCsrfCookie()]);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://api.test/sanctum/csrf-cookie");
  });

  it("lets a request use an explicit bearer token (terminal device token)", async () => {
    const { api, requests } = client(
      { status: 200, data: { data: {} } },
      { getAccessToken: async () => "cashier-token" },
    );

    await api.get("/terminal/cashiers", { bearerToken: "device-token" });
    await api.get("/auth/me");

    expect(requests[0].headers.get("Authorization")).toBe("Bearer device-token");
    expect(requests[1].headers.get("Authorization")).toBe("Bearer cashier-token");
  });

  it("reports 401 UNAUTHENTICATED but not rejected credentials", async () => {
    const onUnauthenticated = vi.fn();
    const expired = client(
      { status: 401, data: { error: { code: "UNAUTHENTICATED", message: "Authentication is required.", details: {}, request_id: null } } },
      { onUnauthenticated },
    );
    await rejection(expired.api.get("/auth/me"));
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);

    const wrongPassword = client(
      { status: 401, data: { error: { code: "INVALID_CREDENTIALS", message: "Wrong.", details: {}, request_id: null } } },
      { onUnauthenticated },
    );
    await rejection(wrongPassword.api.post("/auth/login", {}));
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});
