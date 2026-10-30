import { getApiClient } from "@/lib/api";

import type { HealthStatus } from "./types";

export async function fetchHealth(): Promise<HealthStatus> {
  const api = await getApiClient();
  return api.get<HealthStatus>("/health", { timeout: 5_000 });
}
