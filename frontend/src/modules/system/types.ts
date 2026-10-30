import type { IsoDateTime } from "@/types/common";

/** GET /api/v1/health */
export interface HealthStatus {
  status: "ok" | "degraded";
  api_version: string;
  server_time: IsoDateTime;
  timezone: string;
  currency: string;
  checks: { database: "ok" | "unavailable" };
}
