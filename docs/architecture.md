# Compriva architecture

Compriva is one product with three runtimes that share one UI codebase:

| Runtime | Built from | Runs on | Talks to | Offline? |
| ------- | ---------- | ------- | -------- | -------- |
| **Cloud backend** | `backend/` (Laravel 12) | Cloud server | Central MySQL | n/a: the source of truth |
| **Web management app** | `frontend/` (Next.js server build) | Browser | Cloud API (session cookie) | No, needs the API |
| **Checkout terminal** | `frontend/` (static export) + `frontend/src-tauri/` | Windows PC, one per lane | Local SQLite + Cloud API (bearer token) | **Yes** |

```
                ┌──────────────────────────────────────────────┐
  Browser  ───▶ │  Web management app (Next.js)                │──┐
                └──────────────────────────────────────────────┘  │ HTTPS · Sanctum cookie
                ┌──────────────────────────────────────────────┐  │
  Lane 1   ───▶ │  Terminal: Tauri 2 (Rust) + Next.js export   │──┤ HTTPS · Sanctum bearer token
                │  Local SQLite · device identity · printer    │  │ + X-Compriva-Device
                └──────────────────────────────────────────────┘  │ (sync when online)
  Lane N   ───▶   … one per checkout lane …                      ─┤
                                                                   ▼
                ┌──────────────────────────────────────────────────────────┐
                │  Laravel REST API /api/v1 — business rules, auth, sync   │
                │  Central MySQL 8.4: products, stock, users, sales, …     │
                └──────────────────────────────────────────────────────────┘
```

## 1. Boundaries and responsibilities

### Laravel owns the business rules

- All authoritative calculations (prices, VAT, discounts, stock, profit, cash reconciliation) are
  defined in `backend/app/Domain/*`. The central MySQL database is the single source of truth.
- Authentication, authorization (roles and permissions), and device registration and revocation.
- Accepting offline operations from terminals idempotently and reconciling them
  ([offline-sync.md](offline-sync.md)).

### Next.js provides the shared UI and nothing server-side

- The same React code renders the web app and the terminal UI.
- **No business logic on the Next.js server.** Because the terminal is a static export, the
  frontend may not use Server Actions, route handlers, `cookies()`, Proxy (middleware), rewrites,
  ISR or dynamic routes without `generateStaticParams`. All data comes from the Laravel API
  through client components.
- Terminal checkout needs to compute totals offline. Those calculations are a **mirror** of the
  backend rules, kept in one place in the frontend (the future `modules/pos` pricing code) and
  verified against the backend with shared test cases. If they disagree, the backend's result
  is authoritative.

### Tauri provides native Windows integration

- Device identity (`src-tauri/src/device.rs`), local SQLite (`tauri-plugin-sql` + migrations in
  `src-tauri/src/local_db.rs`), and later: receipt printing, cash drawer, secure token storage
  (Windows Credential Manager) and auto-update.
- Rust exposes small, typed commands. UI code reaches them only through `src/platform`.

### Data ownership

| Data | Owner (write) | Copies |
| ---- | ------------- | ------ |
| Products, prices, barcodes, categories, tax and receipt settings | Cloud (web app) | Read-only snapshot on each terminal |
| Users, roles, permissions | Cloud | Terminals cache cashier PIN hashes for offline sign-in |
| Stock levels | Cloud | Terminals hold **stock allocations** they may sell from offline |
| Sales, voids, returns, payments, shifts, cash movements | Created on the terminal (offline-capable) | Pushed to the cloud; the cloud is the system of record after sync |
| Purchasing, receiving, adjustments | Cloud (web app) | None |

## 2. Identity and authentication

| Actor | Identity | Authenticates with |
| ----- | -------- | ------------------ |
| Web user | `users` row | Sanctum **session cookie** (`/sanctum/csrf-cookie` then login). Same-site, not readable by page scripts |
| Terminal | Install ID (UUIDv4 generated on first launch, `%APPDATA%\com.compriva.pos\device.json`) + server-assigned terminal code (e.g. `T01`) after registration | Sanctum **device token** (bearer), stored in Windows Credential Manager |
| Cashier on a terminal | `users` row | Online: credentials via API. Offline: PIN checked against a locally cached hash; the session is attributed to the cashier in every operation |

Every request from a terminal carries `X-Compriva-Device: <install id>`. The server rejects
requests whose device is unknown or revoked (`DEVICE_NOT_REGISTERED`, `DEVICE_REVOKED`).
A corrupt `device.json` stops the app instead of generating a new identity, so a terminal can
never silently show up as a new device.

## 3. Project structure

### Backend (`backend/`)

```
app/
├── Domain/                 Business rules, one folder per module (see app/Domain/README.md)
│   ├── Catalog/  Inventory/  Purchasing/  Customers/  Sales/  Payments/
│   └── Cashiering/  Reporting/  Identity/  Settings/  Devices/  Sync/
├── Http/
│   ├── Controllers/Api/V1/<Module>/   Thin controllers: validate → call Action → return Resource
│   ├── Middleware/AssignRequestId.php
│   ├── Requests/V1/<Module>/          FormRequest validation
│   └── Resources/V1/<Module>/         JSON output (API Resources)
├── Models/                 Eloquent models (owned by the module that owns the table)
└── Support/                Cross-cutting: Errors/ (ErrorCode, BusinessException, ApiExceptionRenderer)
config/compriva.php         Business timezone, currency, API version, sync limits
routes/api.php              /api/v1 routes, grouped per module
```

### Frontend (`frontend/`)

```
src/
├── app/                    Routes only (thin pages that compose module components)
├── modules/<module>/       Feature code, one folder per UI module
│   ├── api.ts              Endpoint functions (use getApiClient())
│   ├── types.ts            Module wire types (snake_case, mirror API Resources)
│   ├── schemas.ts          Zod schemas for forms
│   ├── store.ts            Zustand store (module state)
│   ├── hooks/              React hooks
│   └── components/         Module components
├── components/ui/          shadcn/ui primitives (generated: `npx shadcn add …`)
├── components/             Shared app components (layout, navigation, feedback)
├── lib/
│   ├── api/                API client: createApiClient, ApiError, getApiClient()
│   ├── env.ts              Validated NEXT_PUBLIC_* configuration
│   ├── ids.ts              uuidv7()
│   └── money.ts            formatMoney()
├── platform/               Web vs desktop abstraction (the ONLY place importing @tauri-apps/*)
│   ├── types.ts  web.ts  desktop.ts  index.ts (getPlatform())
└── types/                  Cross-module types: api.ts (envelope, error codes), common.ts
e2e/                        Playwright end-to-end tests
src-tauri/                  Rust desktop shell
├── src/lib.rs              Builder: plugins, commands, setup
├── src/device.rs           Device identity
├── src/local_db.rs         Local SQLite URL + migrations
└── capabilities/           Permissions granted to the UI
```

Modules present now: `system` (foundation diagnostics on `/`). Planned UI modules map 1:1 to
the module list in the specification: dashboard, pos, products, inventory, purchasing, customers,
cashier, sales, payments, reports, users, settings, devices.

### Planned route map

Route groups separate the two shells without affecting URLs:

| Group | Shell | Example routes | Available on |
| ----- | ----- | -------------- | ------------ |
| `app/(auth)` | Minimal | `/login` | Web + desktop |
| `app/(management)` | Sidebar dashboard | `/dashboard`, `/products`, `/inventory`, `/reports`, `/settings` | Web (desktop: manager functions only) |
| `app/(terminal)` | Full-screen checkout | `/pos`, `/pos/shift` | Desktop |

Record pages use query parameters (`/products/edit?id=…`) rather than dynamic segments,
because the static export cannot prerender records it does not know at build time.

## 4. Platform abstraction

`getPlatform()` returns a `Platform` (see `src/platform/types.ts`):

| Member | Web | Desktop |
| ------ | --- | ------- |
| `kind` | `"web"` | `"desktop"` |
| `authMode` | `"cookie"` | `"bearer"` |
| `getDeviceIdentity()` | `null` | Tauri command `device_identity` |
| `getAccessToken()` | `null` | Cashier session token (memory) if signed in, else device token (Windows Credential Manager) |
| `terminal` | `null` | Device token storage, cashier session token, native PIN verification |
| `getLocalDatabase()` | `null` | `tauri-plugin-sql` connection to `sqlite:compriva.db` |

Detection uses `isTauri()`. The desktop implementation is loaded with a dynamic `import()`, so the
web bundle never contains Tauri plugin code. New native capabilities (printer, cash drawer,
scanner tuning) are added as `Platform` members, never as direct `invoke()` calls in modules.

## 5. Cross-cutting decisions

| Topic | Decision |
| ----- | -------- |
| API style | REST, JSON, versioned under `/api/v1` ([api-conventions.md](api-conventions.md)) |
| Errors | One envelope and code catalog ([error-handling.md](error-handling.md)) |
| IDs | **UUIDv7** primary keys for every application table, so terminals can create records offline. Exceptions: framework tables and the `sync_changes` cursor ([database.md](database.md)) |
| Money | `DECIMAL(15,4)` in MySQL, 4-decimal strings in the API and TypeScript (`"75.0000"`). bcmath on the backend; never JS floats |
| Quantities | `DECIMAL(15,4)` in base units; decimal strings in the API (`"1.2500"` kg) |
| Conversions / tax rates | `DECIMAL(15,6)` unit conversion factors; `DECIMAL(7,4)` tax rate percentages |
| Database | Schema, integrity rules and ERD: [database.md](database.md) |
| Time | Stored and transmitted in UTC (ISO-8601 `Z`). Business day and display use `Asia/Manila` (`config('compriva.timezone')`) |
| Field naming | snake_case on the wire and in TypeScript wire types; no conversion layer |
| Offline | Terminal is local-first: every sale commits to SQLite first, then syncs ([offline-sync.md](offline-sync.md)) |
| Configuration | [environment.md](environment.md) |
| Standards | [coding-standards.md](coding-standards.md) |
