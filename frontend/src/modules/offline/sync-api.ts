import { ApiError, getApiClient } from "@/lib/api";

import type { SyncApi } from "./sync-engine";
import type { Allocation, OperationResult, OutboxOperation, PullResponse } from "./types";

/**
 * Sync endpoints over HTTP, authenticated with the terminal's own device token
 * (kept in the Windows Credential Manager), never a cashier's session: sync
 * keeps running while a cashier is signed in offline or nobody is signed in.
 */
export function httpSyncApi(getDeviceToken: () => Promise<string | null>): SyncApi {
  const client = async () => {
    const token = await getDeviceToken();
    if (!token) throw new ApiError({ code: "DEVICE_NOT_REGISTERED", message: "This terminal has no sync token yet. Set it up on the Point of Sale page.", status: 401 });
    return { api: await getApiClient(), token };
  };

  return {
    async push(operations: OutboxOperation[]): Promise<OperationResult[]> {
      const { api, token } = await client();
      return (await api.post<{ results: OperationResult[] }>("/sync/operations", { operations }, { bearerToken: token, timeout: 60_000 })).results;
    },
    async pull(cursor: number | null, limit = 500): Promise<PullResponse> {
      const { api, token } = await client();
      return api.get<PullResponse>("/sync/changes", { bearerToken: token, timeout: 60_000, params: cursor === null ? {} : { cursor, limit } });
    },
    async topUp() {
      const { api, token } = await client();
      return api.post<{ allocations: Allocation[]; excess: { sku_id: string; quantity: string }[] }>("/sync/allocations/top-up", {}, { bearerToken: token });
    },
  };
}

/** Asks the server for this terminal's device token (needs a signed-in user online). */
export async function requestSyncToken(): Promise<string> {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return (await api.post<{ token: string }>("/pos/terminal/sync-token")).token;
}
