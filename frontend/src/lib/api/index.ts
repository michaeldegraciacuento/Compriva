import { env } from "@/lib/env";
import { getPlatform } from "@/platform";

import { createApiClient, type ApiClient } from "./client";
import type { ApiError } from "./errors";

export { ApiError, toApiError } from "./errors";
export type { ApiClient, ApiRequestConfig } from "./client";

let client: Promise<ApiClient> | null = null;
const unauthenticatedListeners = new Set<(error: ApiError) => void>();

/** Subscribe to "session/token no longer valid" (the auth store signs the user out). */
export function onUnauthenticated(listener: (error: ApiError) => void): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

/** The app-wide API client, configured for the current platform. Browser-only. */
export function getApiClient(): Promise<ApiClient> {
  client ??= getPlatform().then((platform) =>
    createApiClient({
      baseUrl: env.NEXT_PUBLIC_API_URL,
      authMode: platform.authMode,
      getAccessToken: () => platform.getAccessToken(),
      getDeviceId: async () => (await platform.getDeviceIdentity())?.installId ?? null,
      onUnauthenticated: (error) => unauthenticatedListeners.forEach((listener) => listener(error)),
    }),
  );
  return client;
}
