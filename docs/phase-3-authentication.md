# Phase 3: Authentication and authorization

Completed 2026-10-31. Design and reference: [authentication.md](authentication.md).

## Features

| Requirement | Implementation |
| ----------- | -------------- |
| Login / logout | Web: Sanctum session (`POST /auth/login`, `/auth/logout`). Terminal: PIN sign-in → device-bound token |
| User profile | `GET /auth/me`, `PATCH /auth/profile`; profile page |
| User management | `/users` CRUD, roles, suspend/activate, credential reset, revoke access |
| Role management | `/roles` CRUD + permission assignment; owner and system roles protected |
| Permission management | Code-defined catalog (34), `GET /permissions`, assigned through roles |
| Password change | `PUT /auth/password` (current password, policy, signs out other sessions) |
| Activation / suspension | `POST /users/{id}/suspend` and `/activate` (suspension revokes tokens and sessions) |
| Device registration | `POST /devices` → one-time pairing code → `POST /terminal/pair` → device token |
| Token revocation | Own tokens, a user's tokens, and all tokens of a terminal |
| Roles | Owner, Manager, Cashier, Inventory clerk (seeded, from Phase 2) |

## Security requirements

| Requirement | How |
| ----------- | --- |
| Validate permissions on the backend | Gate per permission + `can:` middleware; actor middleware on every protected route (a test asserts every route has it) |
| Rate limiting | `api`, `login`, `terminal-login`, `pairing` limiters |
| Protect sensitive endpoints | `auth:sanctum` + `actor.*` + `can:`; tests send anonymous requests to every protected route and expect 401 |
| No plaintext passwords | bcrypt `hashed` casts for passwords and PINs; SHA-256 pairing codes; Sanctum token hashes; audit redaction |
| Never rely on frontend permissions | Backend checks on every request; e2e test calls an admin API as a cashier → 403 |
| Secure offline auth for terminals | Cached bcrypt PIN hashes with expiry, native verification, lockouts, Credential Manager for the device token |

## Changes

**Backend:** migration `2026_10_31_100000_add_authentication_columns` (pairing code hash and expiry on
devices; `device_id` on tokens). New error codes `INVALID_CREDENTIALS`, `ACCOUNT_SUSPENDED`,
`PAIRING_CODE_INVALID`. Middleware `EnsureActiveUser` and `EnsureActiveDevice`. Rate limiters,
gates and password policy in `AppServiceProvider`. `AuditLogger`, `PinRule`, `AccessControl`. Actions:
`AuthenticateUser`, `AuthenticateCashier`, `ChangePassword`, `SetUserPin`, `CreateUser`,
`SyncUserRoles`, `ChangeUserStatus`, `RevokeUserAccess`, `SaveRole`, `ManageDevices`, `PairDevice`;
query `TerminalCashiers`. 6 controllers, 14 form requests, 7 resources, a custom
`PersonalAccessToken` model, 35 API routes, and the daily `sanctum:prune-expired` schedule.
`/api/v1/me` moved to `/api/v1/auth/me`.

**Desktop (Rust):** `secure_store.rs` (Windows Credential Manager, whitelisted keys), `offline_auth.rs`
(bcrypt PIN verification off the main thread), local migration 2 (`cashiers`, `auth_lockouts`),
4 new commands. Crates: `keyring` 4.2 (`windows-native-keyring-store`), `bcrypt` 0.19.

**Frontend:** platform `terminal` credentials (device token, session token, `verifyPin`); API client
`bearerToken` override and `onUnauthenticated`; auth module (types, API, offline sign-in, Zustand
store, hooks, permissions, login, cashier and pairing forms, guard, profile page); role-based app
shell; routes `/login`, `/` (protected home), `/profile`; shadcn `input`, `label`, `alert`, `separator`.

**Data:** demo cashier PINs changed to 6 digits (482916, 739215) to meet the new PIN policy.

## Verification

| Check | Result |
| ----- | ------ |
| `php artisan test` | **108 passed** (741 assertions). 49 new auth tests in `tests/Feature/Auth` |
| `vendor/bin/pint --test` | pass |
| `npm test` (Vitest) | **44 passed**. New: offline sign-in against the real terminal schema (7), navigation (4), redirect safety (7), login form (3), API client (2) |
| `npm run lint`, `typecheck`, web build, desktop static export | pass |
| `npm run test:e2e` (Playwright) | **7 passed**: redirect + return, generic error, owner and cashier menus, API refuses a cashier, sign-out, foundation |
| `cargo test` / `clippy -D warnings` / `fmt` | 6 passed (+1 opt-in Credential Manager roundtrip, run and passed) / clean / clean |
| Live terminal flow (HTTP, dev server) | register T09 → pair → device check → cashier PIN login → `/auth/me` on T09 → snapshot (bcrypt hashes) → wrong PIN 401 → revoke → device and cashier tokens 401 |

## Notes

- `next dev` shows an "instant navigation" insight for `app/(app)`: protected pages render only
  after the client knows the user. It is dev-only. The opt-out (`export const instant = false`)
  breaks the desktop static export, so it is not used.
- The dev database contains the revoked test terminal `T09` from the live check. It cannot be
  deleted because audit logs reference it.
- User, role and device management have APIs but no screens yet. The navigation shows them as "Soon".
