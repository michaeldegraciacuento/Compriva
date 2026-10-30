import type { IsoDateTime, Uuid } from "@/types/common";

export interface RoleSummary {
  id: Uuid;
  name: string;
  display_name: string;
}

/** UserResource */
export interface AuthUser {
  id: Uuid;
  name: string;
  username: string;
  email: string | null;
  is_active: boolean;
  has_pin: boolean;
  roles: RoleSummary[];
  last_login_at: IsoDateTime | null;
  created_at: IsoDateTime | null;
  updated_at: IsoDateTime | null;
}

/** DeviceResource (subset used by the UI) */
export interface TerminalDevice {
  id: Uuid;
  code: string;
  name: string;
  status: "pending" | "active" | "revoked";
  install_id: Uuid | null;
}

/** AuthSessionResource: POST /auth/login, GET /auth/me, POST /terminal/login */
export interface AuthSessionResponse {
  user: AuthUser;
  permissions: string[];
  auth: {
    method: "session" | "token";
    device: TerminalDevice | null;
    expires_at: IsoDateTime | null;
  };
  /** Only from POST /auth/token (desktop app). */
  token?: string;
  token_expires_at?: IsoDateTime;
}

/** GET /terminal/cashiers */
export interface CashierSnapshot {
  cashiers: {
    id: Uuid;
    name: string;
    username: string;
    pin_hash: string;
    roles: string[];
    permissions: string[];
    updated_at: IsoDateTime | null;
  }[];
  generated_at: IsoDateTime;
  valid_until: IsoDateTime;
}

/** The session the UI works with, whether it was established online or offline. */
export interface Session {
  user: Pick<AuthUser, "id" | "name" | "username"> & Partial<AuthUser>;
  roles: string[];
  permissions: string[];
  /** online: verified by the server. offline: PIN checked against the terminal's cached hash. */
  mode: "online" | "offline";
  method: "session" | "token" | "offline-pin";
  device: TerminalDevice | null;
}
