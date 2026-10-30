# Compriva

**Grocery POS & Retail Management** — *Simplify Retail. Control Everything.*

Compriva is a grocery Point of Sale and retail management system with a web-based
management platform and a Windows desktop checkout application that keeps selling offline.

| Folder      | Contents                                                              |
| ----------- | --------------------------------------------------------------------- |
| `backend/`  | Laravel 12 REST API (Sanctum auth, business logic, sync)              |
| `frontend/` | Next.js + TypeScript + Tailwind + shadcn/ui (web app and desktop UI)  |
| `frontend/src-tauri/` | Tauri 2 desktop shell (Rust) with the SQLite plugin         |
| `docs/`     | Architecture notes and phase documentation                            |

## Prerequisites (Windows)

- PHP 8.2+ with Composer (XAMPP PHP is used in development)
- MySQL-compatible server (XAMPP MariaDB in development; MySQL 8.4 LTS in production)
- Node.js 24 + npm
- Rust (stable, MSVC toolchain), Visual Studio Build Tools 2022 with C++ workload, WebView2 runtime

See [docs/phase-0-environment-setup.md](docs/phase-0-environment-setup.md) for verified versions.

## First-time setup

```powershell
# Database (XAMPP MariaDB must be running)
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS compriva CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS compriva_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Backend
cd backend
composer install
Copy-Item .env.example .env
php artisan key:generate
php artisan migrate

# Frontend
cd ..\frontend
npm install
Copy-Item .env.example .env.local
npx playwright install chromium   # for end-to-end tests
```

## Development servers

```powershell
# 1. Database: start MySQL from the XAMPP Control Panel

# 2. Backend API -> http://localhost:8000
cd backend
php artisan serve

# 3a. Web application -> http://localhost:3000
cd frontend
npm run dev

# 3b. OR the desktop app (starts its own Next.js on :1420, then opens the Tauri window)
cd frontend
npm run desktop:dev
```

Run either `npm run dev` or `npm run desktop:dev` at a time (one `next dev` per project). Both sign in with the same username and password.

## Checks

```powershell
cd backend;  vendor/bin/pint --test; php artisan test
cd frontend; npm run lint; npm run typecheck; npm test; npm run build; npm run test:e2e
cd frontend\src-tauri; cargo fmt --check; cargo clippy --all-targets -- -D warnings; cargo test
```

The web app at http://localhost:3000 currently shows a foundation diagnostics page (platform,
device identity, local database, API health). See [docs/README.md](docs/README.md) for the
architecture and standards.
