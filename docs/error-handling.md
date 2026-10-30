# Error handling standards

## The error envelope

Every error from `/api/*`, whatever caused it, has this shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The given data was invalid.",
    "details": { "fields": { "name": ["The name field is required."] } },
    "request_id": "019a2f4c-7b1e-7c3a-9f00-3c2d1e0a5b6c"
  }
}
```

| Field | Meaning |
| ----- | ------- |
| `code` | Stable machine-readable code. **Clients branch on this, never on `message` or status alone** |
| `message` | Human-readable, safe to show to the user |
| `details` | Object (possibly empty) with code-specific data |
| `request_id` | Same as the `X-Request-Id` response header; quote it in bug reports |

Implemented by `App\Support\Errors\ApiExceptionRenderer` (registered in `bootstrap/app.php`).
It is covered by `tests/Feature/Api/ErrorEnvelopeTest.php`.

## Code catalog

Source of truth: `backend/app/Support/Errors/ErrorCode.php`, mirrored in
`frontend/src/types/api.ts` (`API_ERROR_CODES`). Add new codes to **both** files and to this table.

| Code | HTTP | When | Client behaviour |
| ---- | ---- | ---- | ---------------- |
| `BAD_REQUEST` | 400 | Malformed request | Bug: log with request ID |
| `VALIDATION_FAILED` | 422 | Input failed validation. `details.fields` maps field → messages | Show messages next to the form fields |
| `UNAUTHENTICATED` | 401 | No or invalid session/token | Web: go to login. Terminal: re-authenticate the device or cashier |
| `FORBIDDEN` | 403 | Authenticated but not permitted | Show "not allowed" |
| `NOT_FOUND` | 404 | Unknown endpoint or record | Show "not found" |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method | Bug |
| `CONFLICT` | 409 | State conflict (e.g. idempotency key reused with a different payload) | Reload and retry |
| `SESSION_EXPIRED` | 419 | CSRF token or session expired (web) | Fetch CSRF cookie, sign in again |
| `TOO_MANY_REQUESTS` | 429 | Rate limited (`Retry-After` header) | Back off and retry |
| `INVALID_CREDENTIALS` | 401 | Wrong username/password or username/PIN. Same message for every cause | Show `message`; never hint which part was wrong |
| `ACCOUNT_SUSPENDED` | 403 | Correct credentials (or a still-valid session/token) for a suspended account | Show `message`; sign the UI out |
| `PAIRING_CODE_INVALID` | 422 | Pairing code wrong, expired or already used | Ask a manager for a new code |
| `BUSINESS_RULE_VIOLATION` | 422 (or as thrown) | A domain rule rejected the action. `details` explains | Show `message` |
| `INSUFFICIENT_STOCK` | 422 | A stock-out or sale needs more than is available (overall or in the chosen batch). Nothing was posted | Show `message`; reduce the quantity |
| `TERMINAL_REQUIRED` | 409 | The POS request did not come from a registered terminal (`X-Compriva-Device` unknown) | Show the "set up this terminal" screen |
| `SHIFT_REQUIRED` | 409 | Selling or a return needs the user's open shift on this terminal | Show the "open a shift" screen |
| `APPROVAL_REQUIRED` | 403 | A discount, price change, void or return needs a permission the user lacks; `details.permission` names it (`details.reason = invalid_approver` when the manager credentials were wrong) | Ask for a manager's username and PIN, then retry with `approval` |
| `TOTAL_MISMATCH` | 409 | The server's total differs from the `expected_total` the cashier saw (prices changed). Nothing was saved | Reload the cart's prices and take payment again |
| `DEVICE_NOT_REGISTERED` | 401 | No device token, or `X-Compriva-Device` does not match the token's terminal | Start device pairing |
| `DEVICE_REVOKED` | 403 | Terminal was revoked by an admin | Stop syncing; show a blocking notice |
| `DUPLICATE_OPERATION` | 200/409 | Sync operation already applied | Mark it synced (not an error for the outbox) |
| `SERVICE_UNAVAILABLE` | 503 | Maintenance or dependency down | Retry later; terminal stays offline-capable |
| `SERVER_ERROR` | 500 | Unexpected failure | Retry later; report with request ID |

Domain modules add specific codes as they are built, e.g.
`SHIFT_NOT_OPEN`, `ALLOCATION_EXHAUSTED`, `PRICE_CHANGED`.

Client-only codes (never sent by the server, produced by the frontend's `ApiError`):

| Code | When |
| ---- | ---- |
| `NETWORK_ERROR` | Server unreachable (offline, DNS, CORS, connection refused) |
| `TIMEOUT` | No response in time (default 15 s) |
| `INVALID_RESPONSE` | Response was not the Compriva envelope (captive portal, proxy page, wrong API URL) |

## Backend rules

1. **Expected failures throw a `BusinessException`** (or a module subclass in
   `Domain/<Module>/Exceptions/`) with a code, status and `details`. Never build error JSON by hand
   in controllers.
2. Validation lives in **FormRequest** classes. Laravel's `ValidationException` is rendered as
   `VALIDATION_FAILED` automatically.
3. Use `findOrFail` / route model binding for lookups. Missing records become `NOT_FOUND`
   without leaking model class names.
4. Authorization uses policies and gates. Denials become `FORBIDDEN`.
5. Unexpected exceptions are logged with the `request_id` in the log context, and the client gets
   `SERVER_ERROR`. With `APP_DEBUG=false` the original message is **never** returned. Production
   must run with `APP_DEBUG=false`.
6. Writes that touch several tables run in `DB::transaction()`. A failure leaves nothing half-written.
7. Never catch and swallow exceptions. Catch only to add context or to translate into a
   `BusinessException`, and `report()` anything unexpected.

## Frontend rules

1. Every API call goes through `getApiClient()` and throws only **`ApiError`**
   (`src/lib/api/errors.ts`):

   | Member | Use |
   | ------ | --- |
   | `code` | Branch on it |
   | `message` | Show to the user |
   | `fieldErrors` | Map to the form, e.g. `setError(field, { message })` with React Hook Form |
   | `isOffline` | `NETWORK_ERROR` or `TIMEOUT`. Terminals fall back to local data / outbox |
   | `isRetryable` | Offline, 429, 503 or 5xx: safe to retry with backoff |
   | `requestId` | Show in error dialogs ("Reference: …") and include in logs |

2. Components never inspect axios errors or HTTP statuses directly.
3. Each route segment that loads data gets an `error.tsx` boundary showing a friendly message and
   a retry button. Unhandled render errors must never show a blank screen at a checkout lane.
4. User-facing messages are short and actionable. Technical detail (`code`, `requestId`) goes in a
   secondary line.

## Desktop (Rust) rules

1. Tauri commands return `Result<T, String>` (or a serializable error type). They never `panic!` or
   `unwrap()` on input or I/O.
2. Startup failures that would compromise data or identity (e.g. corrupt `device.json`) stop the
   app with a clear message instead of silently continuing.
3. In development, logs go through `tauri-plugin-log`. Production logging to a rotating file is
   configured in the Devices phase.

## Offline-specific rule

At a terminal, **an offline API is not an error**. Checkout never waits for the network.
`isOffline` errors from background sync are recorded and retried. The cashier only sees a
connectivity indicator, and a warning when the offline limit is approaching
([offline-sync.md](offline-sync.md)).
