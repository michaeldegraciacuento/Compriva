# Coding standards

The checks below run before every commit and on every phase sign-off:

| Area | Command (from the folder) |
| ---- | ------------------------- |
| Backend style | `vendor/bin/pint --test` (fix: `vendor/bin/pint`) |
| Backend tests | `php artisan test` |
| Frontend lint / types | `npm run lint`, `npm run typecheck` |
| Frontend unit tests | `npm test` |
| Frontend E2E | `npm run test:e2e` (DB server must be running) |
| Rust | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (in `frontend/src-tauri`) |

## General

- English for code, comments, commits and docs.
- Comments explain **why**, not what. Public classes and functions get a short docblock stating
  their purpose.
- Money and quantities: `DECIMAL(15,4)` in the database, decimal strings everywhere else. Do arithmetic
  with bcmath (PHP) or a decimal library (TypeScript). A `float`, or JS `+`/`*` on peso values, is a bug.
- Time: UTC in storage and on the wire. Convert to Asia/Manila only for business-day logic and display.
- No secrets in code or in `NEXT_PUBLIC_*` variables.
- Each phase updates its documentation in `docs/`.

## Backend (Laravel / PHP)

- Style: **Laravel Pint** (default Laravel preset). PSR-4 autoloading; one class per file.
- Layering per request: **Route → FormRequest (validation) → Controller (thin) → Domain Action →
  Model(s) → API Resource**.
  - Controllers have no business logic: no queries beyond route model binding, no calculations.
  - Actions are named as verb phrases (`CompleteSale`, `ReceivePurchaseOrder`), have one public
    method, and are covered by tests.
  - Cross-module calls go through the other module's Actions/Queries, never its tables.
- Naming: controllers `ProductController` (resource) or invokable `CloseShiftController`; requests
  `StoreProductRequest` / `UpdateProductRequest`; resources `ProductResource`; enums singular
  (`SaleStatus`) with string backing values in snake_case.
- Database:
  - Migrations are immutable once merged. Create a new migration to change schema.
  - Follow [database.md](database.md): `uuid('id')->primary()` + `HasUuids` (UUIDv7) on every
    application table; `decimal(15, 4)` for money and quantities, `decimal(15, 6)` for conversion
    factors, `decimal(7, 4)` for tax rates; `datetimes()` (not `timestamps()`, which uses 2038-limited TIMESTAMP).
  - Foreign keys `restrictOnDelete()` unless the child is pure non-financial detail of its parent.
  - Ledgers and financial records use the `AppendOnly` trait plus `Integrity::preventUpdates/Deletes`
    triggers; CHECK constraints go through `Integrity::check()`.
  - Cast money and quantity columns with `decimal:4` (strings) and compute with `bc*` functions.
  - Foreign keys and indexes are declared explicitly; no polymorphic relations without a reason.
  - Multi-table writes run inside `DB::transaction()`.
- Errors: throw `BusinessException` subclasses; see [error-handling.md](error-handling.md).
- Config: read `env()` **only** inside `config/*.php`; application code uses `config()`.
- Tests: Feature tests for every endpoint (happy path + validation + authorization), Unit tests for
  Actions with non-trivial rules. Tests use the `compriva_test` database with `RefreshDatabase`.

## Frontend (Next.js / TypeScript)

- TypeScript `strict`. No `any`; use `unknown` and narrow it. Prefer `interface` for object shapes and
  `type` for unions.
- Files and folders: kebab-case (`foundation-status.tsx`). Components: PascalCase. Hooks: `useX`.
- **Static-export compatibility** (the desktop build): no Server Actions, route handlers,
  `cookies()`/`headers()`, Proxy (middleware), rewrites/redirects in `next.config`, ISR, or dynamic
  segments without `generateStaticParams`. Data loading happens in client components through the API client.
- `"use client"` is required for anything that uses the platform, the API client, browser APIs or
  state. Pages stay small Server Components that compose module components where possible.
- Module boundaries:
  - Routes (`src/app`) import from modules; modules never import from `src/app`.
  - A module may import another module only through that module's public files (`api.ts`,
    `types.ts`, exported components), never its internals.
  - **Only `src/platform/` imports `@tauri-apps/*`.**
  - Only `src/lib/api/` imports `axios`.
- Data and state:
  - Endpoint functions live in `modules/<m>/api.ts` and return typed data (`api.get<T>()`).
  - Wire types mirror the API's snake_case fields exactly.
  - Forms: React Hook Form + Zod schema (`modules/<m>/schemas.ts`); map `ApiError.fieldErrors` back into the form.
  - Global/module state: Zustand stores in `modules/<m>/store.ts`. Keep server data out of global
    stores unless it is needed offline.
- UI: shadcn/ui primitives in `components/ui` (add with `npx shadcn add <name>`; edit only for
  project-wide changes). Icons: `lucide-react`. Charts: `recharts`. Dates: `date-fns`.
- Formatting money: `formatMoney()` (takes the API's decimal string). IDs created on the client: `uuidv7()`.
- UI: follow [design-system.md](design-system.md). Use the shared components (`PageHeader`, `Panel`, `StatCard`, `StatusBadge`, …) and tokens; no raw hex colors in components; grids declare `grid-cols-1`; status never by color alone.
- Tests: Vitest for logic (`*.test.ts` next to the file); Playwright for user flows (`e2e/`).
  Checkout and sync logic require unit tests before merge.

## Desktop (Rust / Tauri)

- `cargo fmt` and `cargo clippy -D warnings` clean.
- Commands are thin, typed (`serde` structs with `rename_all = "camelCase"`), return `Result`, and
  are registered in `lib.rs`. Logic lives in its own module (`device.rs`, `local_db.rs`, …) with unit tests.
- Every new command or plugin needs an explicit capability in `src-tauri/capabilities/` with the
  narrowest permission that works.
- Local SQLite migrations are files in `src-tauri/migrations/NNNN_name.sql` (loaded by `local_db.rs`), append-only, tables `STRICT`. sqlx checksums applied migrations: **never edit a shipped file, not even whitespace**. Add a new version and pin its SHA-384 in the `local_db` test.
- No `unwrap()`/`expect()` on runtime input or I/O, except at startup when continuing would corrupt data.

## Git

- Branches: `main` is always releasable; work on `phase-N/<topic>` or `feature/<topic>` and merge
  via pull request once all checks pass.
- Commits: Conventional Commits: `feat(sales): …`, `fix(sync): …`, `docs: …`, `chore: …`,
  `test: …`, `refactor: …`.
- Never commit `.env`, `.env.local`, databases, `vendor/`, `node_modules/`, `target/`, `out/`, `.next/`.
