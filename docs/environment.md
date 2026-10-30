# Environment configuration

| Environment | Backend `APP_ENV` | Frontend `NEXT_PUBLIC_APP_ENV` | Database |
| ----------- | ----------------- | ------------------------------ | -------- |
| Local development | `local` | `local` | XAMPP MariaDB 10.4 (`compriva`) |
| Automated tests | `testing` (phpunit.xml) | n/a (`http://api.test` in Vitest) | `compriva_test` |
| Staging | `staging` | `staging` | MySQL 8.4 |
| Production | `production` | `production` | MySQL 8.4 |

Templates are committed (`backend/.env.example`, `frontend/.env.example`). Real files
(`backend/.env`, `frontend/.env.local`) are git-ignored.

## Backend: `backend/.env`

Laravel defaults apply to everything not listed. Compriva-specific and security-relevant values:

| Variable | Local value | Production | Notes |
| -------- | ----------- | ---------- | ----- |
| `APP_NAME` | `Compriva` | `Compriva` | |
| `APP_ENV` | `local` | `production` | |
| `APP_DEBUG` | `true` | **`false`** | `true` exposes exception messages in API errors |
| `APP_URL` | `http://localhost:8000` | `https://api.<domain>` | |
| `DB_CONNECTION` | `mysql` | `mysql` | Works with MariaDB locally |
| `DB_HOST` / `DB_PORT` / `DB_DATABASE` | `127.0.0.1` / `3306` / `compriva` | managed MySQL | |
| `DB_USERNAME` / `DB_PASSWORD` | `root` / *(empty)* | dedicated least-privilege user | |
| `COMPRIVA_TIMEZONE` | `Asia/Manila` | `Asia/Manila` | Business day and display; storage stays UTC |
| `COMPRIVA_CURRENCY` | `PHP` | `PHP` | |
| `COMPRIVA_SYNC_MAX_BATCH_SIZE` | `100` | `100` | Max operations per sync push |
| `COMPRIVA_SYNC_MAX_OFFLINE_HOURS` | `72` | store policy | Terminals stop selling after this long without sync |
| `FRONTEND_URL` | `http://localhost:3000` | `https://app.<domain>` | |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://tauri.localhost,tauri://localhost` | `https://app.<domain>,http://tauri.localhost` | Comma-separated; exact origins |
| `SANCTUM_STATEFUL_DOMAINS` | `localhost:3000,127.0.0.1:3000` | `app.<domain>` | Hosts using cookie auth |
| `SESSION_DOMAIN` | `null` | `.<domain>` | Lets the API and the web app share the session cookie |
| `SESSION_SECURE_COOKIE` | *(unset)* | `true` | |
| `COMPRIVA_OWNER_USERNAME` | `owner` | chosen username | First owner account created by `db:seed` |
| `COMPRIVA_OWNER_PASSWORD` | *(empty → `password`, local only)* | **required** | Seeder refuses to run without it outside `local`/`testing` |
| `COMPRIVA_STORE_CODE` / `COMPRIVA_STORE_NAME` | `MAIN` / `Compriva Grocery` | real values | The store row created by `db:seed` |

The database user that runs migrations needs the `TRIGGER` privilege. On managed MySQL with
binary logging, also set `log_bin_trust_function_creators = 1` ([database.md §6](database.md#6-mysql-84--mariadb-compatibility-and-operations)).

Production hosting: the web app and API should share a parent domain
(`app.example.ph` + `api.example.ph`), which Sanctum cookie authentication requires.

## Frontend: `frontend/.env.local`

| Variable | Local value | Notes |
| -------- | ----------- | ----- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | API origin without `/api/v1`. Validated at startup (`src/lib/env.ts`) |
| `NEXT_PUBLIC_APP_ENV` | `local` | `local` · `staging` · `production` |

`NEXT_PUBLIC_*` values are **inlined at build time**, into both the web build and the desktop
bundle. Build each environment with its own values. They are public: never put secrets there.

Desktop terminals ship with the build-time API URL as a default. During registration (Devices
phase) a terminal can store an override in `local_meta.api_url`, so one installer can serve
several stores or staging.

## Desktop: Tauri

| Setting | Where | Value |
| ------- | ----- | ----- |
| Bundle identifier | `src-tauri/tauri.conf.json` | `com.compriva.pos` (do not change: it determines the data folder) |
| App data folder | derived | `%APPDATA%\com.compriva.pos\` |
| Device identity | app data | `device.json` |
| Local database | app data | `compriva.db` (+ `-wal`, `-shm`) |
| Dev server | `tauri.conf.json → build.devUrl` | `http://localhost:3000` |
| Production web origin | WebView2 | `http://tauri.localhost`, which must be in `CORS_ALLOWED_ORIGINS` |

To reset a development terminal completely, close the app and delete `%APPDATA%\com.compriva.pos`.
It then gets a **new** device identity.
