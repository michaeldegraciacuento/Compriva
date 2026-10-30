# Phase 0: Development environment setup

Completed 2026-10-30 on Windows 11 Enterprise (10.0.22631).

## Verified toolchain

| Tool | Version | Location / notes |
| ---- | ------- | ---------------- |
| PHP | 8.2.12 (ZTS, x64) | `C:\xampp\php` |
| Composer | 2.10.3 | |
| Laravel Installer | 5.32.0 | |
| MariaDB (XAMPP) | 10.4.32 | `C:\xampp\mysql`, port 3306, user `root`, no password |
| Node.js | 24.22.0 | |
| npm | 11.19.1 | |
| Rust / Cargo | 1.99.1 | `stable-x86_64-pc-windows-msvc` |
| VS Build Tools 2022 | 17.14 (MSVC 14.44) | Windows SDK 10.0.26100.0 |
| WebView2 Runtime | 156.0.4314.50 | |
| Git | 2.52.0 | |

PHP extensions present: bcmath, ctype, curl, fileinfo, mbstring, openssl, PDO, pdo_mysql,
pdo_sqlite, tokenizer, xml, dom, json and others. Not enabled: `zip`, `intl`
(DLLs are in `C:\xampp\php\ext`). Composer extracts packages with Git's `unzip`.

## Installed project packages

**Backend:** laravel/framework 12.70.2, laravel/sanctum 4.3.3, phpunit 11.5.

**Frontend:** next 16.4.3, react 19.3.0, typescript 5.9.3, tailwindcss 4.3.3, shadcn 4.23.0 (CLI),
zustand 5.0.16, axios 1.21.0, zod 4.6.7, react-hook-form 7.91.0, @hookform/resolvers 6.0.2,
lucide-react 1.64.0, recharts 3.10.1, date-fns 4.4.0, @tauri-apps/api 2.12.4,
@tauri-apps/plugin-sql 2.6.0, @tauri-apps/cli 2.12.4, vitest 5.0.5, @playwright/test 1.64.1.

**Desktop (Rust):** tauri 2.12.5, tauri-plugin-sql 2.6.0 (`sqlite` feature, sqlx-sqlite 0.8.6),
tauri-plugin-log 2.

## Deviations from the original plan

| Planned | Used now | Reason / follow-up |
| ------- | -------- | ------------------ |
| Laravel 13, PHP 8.3+ | Laravel 12, PHP 8.2.12 | Uses the existing XAMPP PHP. Laravel 12 bug fixes ended Aug 2026, and security fixes end around Feb 2027. Plan an upgrade to PHP 8.3+ and Laravel 13 before production. |
| MySQL 8.4 LTS | XAMPP MariaDB 10.4.32 | Local development only. Production should use MySQL 8.4. Laravel uses the `mysql` driver so `.env` carries over. |

### Known MariaDB quirk

`php artisan db:show` fails with *Table 'performance_schema.session_status' doesn't exist*:
XAMPP runs MariaDB with `performance_schema` off. This affects only that diagnostic command.

## Configuration done in this phase

### Backend

- `.env` / `.env.example`: `APP_NAME=Compriva`, `APP_URL=http://localhost:8000`, `DB_CONNECTION=mysql`, `DB_DATABASE=compriva`.
- Databases `compriva` and `compriva_test` (utf8mb4_unicode_ci) created.
- `php artisan install:api`: Sanctum, `routes/api.php`, `personal_access_tokens` migration.
- `App\Models\User` uses `HasApiTokens`.
- `phpunit.xml` runs tests against `compriva_test`.

### Frontend

- `create-next-app`: App Router, `src/` directory, `@/*` alias, Tailwind, ESLint.
- `@types/node` raised to ^24 to match Node 24 (needed by Vitest 5's peer range).
- `shadcn init` (defaults); the CLI is kept in devDependencies.
- `next.config.ts`: static export when built by Tauri, server build otherwise.
- `vitest.config.ts`: jsdom, React plugin, `@` alias.
- npm scripts: `typecheck`, `test`, `test:watch`, `tauri`, `desktop:dev`, `desktop:build`.

### Desktop (frontend/src-tauri)

- `tauri init`: product `Compriva`, identifier `com.compriva.pos`, crate `compriva` / `compriva_lib`.
- Main window: "Compriva POS", 1366×768, minimum 1024×700.
- SQL plugin registered in `src/lib.rs`; capabilities `sql:default` and `sql:allow-execute`.

## Verification results

| Check | Result |
| ----- | ------ |
| `php artisan migrate` on MariaDB | 4 migrations ran |
| `php artisan test` | 2 passed |
| `GET /up` / `GET /api/user` (no token) | 200 / 401 |
| `npm run lint` / `npm run typecheck` / `npm test` | pass (no tests yet) |
| `npm run build` (web) | pass |
| Static export (`TAURI_ENV_PLATFORM` set) | pass, `out/index.html` produced |
| `cargo build` (src-tauri) | pass |
| `npm run desktop:dev` | "Compriva POS" window opened and loaded the Next.js page |

## Open items (not blocking)

- `npm audit`: 3 low-severity advisories in `deepmerge`, used by the shadcn CLI (dev only, not shipped).
  `npm audit fix --force` would downgrade shadcn to 1.0.0, so it was not applied.
- npm skipped the `unrs-resolver` postinstall (npm allowScripts). ESLint works without it.
- Cargo sometimes prints *did not finalize incremental compilation session directory … Access is denied*.
  Builds still succeed. It's usually antivirus scanning `target/`. Adding
  `frontend\src-tauri\target` to Defender exclusions removes it.
- ~~Playwright browsers not installed~~ (done in Phase 1: Chromium).
- ~~Timezone~~ decided in Phase 1: store UTC, business day and display in Asia/Manila (`config/compriva.php`).
