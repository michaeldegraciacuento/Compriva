# Phase 1: System architecture

Completed 2026-10-30. Scope: architecture, structure, configuration and foundation code.
**No POS features.**

## Deliverables

| Deliverable | Where |
| ----------- | ----- |
| Architecture documentation | [architecture.md](architecture.md) |
| Project folder structure | [architecture.md §3](architecture.md#3-project-structure), `backend/app/Domain/README.md` |
| Environment configuration | [environment.md](environment.md), `backend/.env.example`, `frontend/.env.example` |
| API conventions | [api-conventions.md](api-conventions.md) |
| Error handling standards | [error-handling.md](error-handling.md) |
| Coding standards | [coding-standards.md](coding-standards.md) |
| Offline synchronization design | [offline-sync.md](offline-sync.md) |

## Decisions

| # | Decision | Alternatives considered |
| - | -------- | ----------------------- |
| 1 | REST `/api/v1`, `{data, meta}` / `{error}` envelopes, snake_case on the wire | Unversioned API; camelCase conversion layer (adds bugs and work for no gain) |
| 2 | Web: Sanctum session cookie. Desktop: Sanctum bearer device token | Tokens in browser storage for both (readable by injected scripts); cookies on desktop (cross-site from `tauri.localhost`, would not work) |
| 3 | Device identity = random install UUID created by Rust on first launch, plus a server-assigned terminal code at registration | Hardware fingerprint (brittle, privacy concerns) |
| 4 | ~~UUIDv7 for offline-creatable records; integer IDs for cloud-only data~~ **Superseded in Phase 2:** UUIDv7 for every application table ([database.md](database.md)) | UUID everywhere (bigger indexes everywhere); auto-increment everywhere (impossible offline) |
| 5 | ~~Money as integer centavos~~ **Superseded in Phase 2:** `DECIMAL(15,4)`, sent as decimal strings | Integer centavos (Phase 1 choice; replaced to meet the Phase 2 specification) |
| 6 | Store UTC; business day in Asia/Manila (`config('compriva.timezone')`) | App timezone Asia/Manila (ambiguous once data crosses systems) |
| 7 | Local-first checkout with outbox + stock allocations | Online-first with offline fallback (two code paths, worse failure behaviour) |
| 8 | Eloquent models stay in `app/Models`; business logic in `app/Domain/<Module>` | Models inside domain folders (needs custom factory and policy resolution) |
| 9 | Desktop static export: no server-side Next.js features anywhere | Separate desktop UI codebase |
| 10 | Local SQLite schema: only `local_meta` now; sync tables come with the Sync phase | Creating the outbox now (would lock in a schema before its consumer exists) |

## Changes made

### Backend

| File | Change |
| ---- | ------ |
| `bootstrap/app.php` | Global `AssignRequestId` middleware; `statefulApi()` for Sanctum cookies; JSON error rendering for `api/*` |
| `app/Http/Middleware/AssignRequestId.php` | Accepts or creates `X-Request-Id`, adds it to the log context and the response |
| `app/Support/Errors/ErrorCode.php` | Error code catalog (enum) |
| `app/Support/Errors/BusinessException.php` | Base exception for domain rule violations |
| `app/Support/Errors/ApiExceptionRenderer.php` | Standard error envelope; hides internals when `APP_DEBUG=false` |
| `app/Http/Controllers/Api/V1/System/HealthController.php` | `GET /api/v1/health` |
| `routes/api.php` | Versioned `/api/v1` group; `/api/user` replaced by `/api/v1/me` |
| `app/Domain/*` | 12 module folders + README |
| `config/compriva.php` | Business timezone, currency, API version, sync limits |
| `config/cors.php` (published) | Origins from `CORS_ALLOWED_ORIGINS`, credentials on, `X-Request-Id` exposed |
| `.env`, `.env.example` | Compriva, CORS and Sanctum variables |
| 4 Laravel stub files | Pint auto-fixes (imports instead of fully-qualified names); no behaviour change |
| `tests/Feature/Api/*` | Health, CORS, envelope, auth and request-ID tests |

### Frontend

| File | Change |
| ---- | ------ |
| `src/lib/env.ts` | Zod-validated `NEXT_PUBLIC_*` config |
| `src/lib/api/` | `createApiClient` (versioned base URL, request ID, auth by platform, device header, idempotency key, envelope unwrapping, CSRF cookie), `ApiError`, `getApiClient()` |
| `src/lib/ids.ts`, `src/lib/money.ts` | UUIDv7 generation, peso formatting |
| `src/platform/` | `Platform` interface, web and desktop implementations, `getPlatform()` |
| `src/types/` | API envelope, pagination, error codes; common aliases |
| `src/modules/system/` | Health API call + foundation diagnostics component |
| `src/app/page.tsx`, `layout.tsx` | Starter page replaced by diagnostics; title "Compriva" |
| `src/components/ui/card.tsx`, `badge.tsx` | shadcn components |
| `public/*.svg` | Starter images removed (unused) |
| `.env.example`, `.env.local`, `.gitignore` | API URL config; `.env.example` committed |
| `vitest.config.mts` | Renamed from `.ts` (ESM warning); test env |
| `playwright.config.ts`, `e2e/foundation.spec.ts` | E2E setup starting Laravel + Next; Chromium installed |
| `eslint.config.mjs`, `tsconfig.json` | Ignore `src-tauri` (Rust build output was being linted) |
| `package.json` | `test:e2e` script |

### Desktop (`frontend/src-tauri`)

| File | Change |
| ---- | ------ |
| `src/device.rs` | Install ID created once, atomically written, reused; corrupt file is an error |
| `src/local_db.rs` | Local DB URL + migration 1 (`local_meta`, STRICT) |
| `src/lib.rs` | Migrations registered, identity loaded at startup, `device_identity` command |
| `tauri.conf.json` | SQL plugin preloads `sqlite:compriva.db` (migrations run at startup) |
| `Cargo.toml` | `uuid` (v4), `tempfile` (dev) |

## Verification

| Check | Result |
| ----- | ------ |
| `php artisan test` | 14 passed (60 assertions) |
| `vendor/bin/pint --test` | pass |
| `npm run lint`, `npm run typecheck` | pass |
| `npm test` (Vitest) | 20 passed: API client (12), UUIDv7 (4), money (2), env (2) |
| `npm run build` (web) and static export | pass; API URL inlined into the desktop bundle |
| `cargo test` | 3 passed (identity reuse, corrupt identity, date conversion) |
| `cargo clippy --all-targets -D warnings` | pass |
| `npm run test:e2e` (Playwright, Chromium) | 1 passed: web platform detected, cross-origin `/api/v1/health` OK through CORS |
| Desktop app launch | Window opened; `device.json` created; `compriva.db` migration 1 applied (checked with PDO SQLite); same install ID after restart |

## Carried forward

- ~~Identity phase: login endpoints, `UserResource`, rate limits, `(auth)` route group.~~ Done in Phase 3.
- Devices phase: registration and device tokens (Windows Credential Manager), `X-Compriva-Device`
  enforcement, API URL override, production logging.
- Sync phase: outbox, `sync_operations`, push and pull endpoints, allocations.
- Confirm BIR POS requirements before the Sales phase ([offline-sync.md §8](offline-sync.md#8-receipt-and-transaction-numbering)).
