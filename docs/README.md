# Compriva

Grocery POS and retail management: a **web app** for the back office and the counter, and a
**Windows desktop app** for checkout lanes that keeps selling without internet.

## 1. Stack and folders

| Folder | What | Tech |
| ------ | ---- | ---- |
| `backend/` | REST API, business rules, sync | Laravel 12, PHP 8.2, Sanctum, MySQL/MariaDB |
| `frontend/` | Web app and the desktop app's screens | Next.js 16, React 19, TypeScript, Tailwind, shadcn/ui |
| `frontend/src-tauri/` | Desktop shell: local SQLite, printing | Tauri 2, Rust |

API base: `/api/v1`. Responses are `{ data, meta }`; errors are `{ error: { code, message, details } }`.

## 2. Install (Windows, development)

You need: XAMPP (PHP 8.2 and MariaDB), Composer, Node.js 24, and for the desktop app Rust (MSVC),
Visual Studio Build Tools 2022 (C++) and WebView2.

```powershell
# Databases (start MySQL in the XAMPP Control Panel first)
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE compriva CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE compriva_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Backend
cd backend
composer install
Copy-Item .env.example .env
php artisan key:generate
php artisan migrate --seed          # roles, reference data, store, owner (+ demo data locally)

# Frontend
cd ..\frontend
npm install
Copy-Item .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Demo accounts** (local only; password `password` for all):

| Username | Role | PIN (terminals, approvals) |
| -------- | ---- | -------------------------- |
| `owner` | Owner (everything) | none |
| `manager` | Store manager | 246810 |
| `cashier1`, `cashier2` | Cashier | 482916, 739215 |
| `clerk` | Inventory clerk | none |

`php artisan migrate:fresh --seed` resets the database.

## 3. Run

```powershell
cd backend;  php artisan serve        # API      http://localhost:8000
cd frontend; npm run dev              # web app  http://localhost:3000
# or, instead of npm run dev:
cd frontend; npm run desktop:dev      # desktop window (its own page server on :1420)
```

- Run only one of `npm run dev` / `npm run desktop:dev` at a time.
- Don't open `localhost:1420` in a browser: it only feeds the desktop window. Browsers use
  `localhost:3000`. On 1420 a browser sees "Session sign-in is only available to the Compriva web
  app".
- Desktop installer: `npm run desktop:build`.

**Checks**

```powershell
cd backend;  vendor/bin/pint --test; php artisan test
cd frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e; npm run test:sync
cd frontend\src-tauri; cargo test
```

`test:e2e` and `test:sync` need MySQL and the API running.

## 4. Main flows

**Sale (web POS or desktop):**
1. Register the computer as a terminal once (owner).
2. The cashier opens a shift with opening cash.
3. Scan or search items, then optionally choose a customer or a discount.
4. Take payment: **Cash, GCash or Maya** (QR code; the reference number is required). Split
   payments are allowed.
5. The sale is saved: stock deducted, receipt numbered `T01-000123`, receipt printed.
6. The cashier closes the shift by counting the drawer; the variance is recorded.

**Rules that never bend**
- **Totals are recalculated by the server.** Money is computed with integers, never floats.
- **A completed sale is never edited.** Fix it with a **void** (manager approval, same shift),
  a **return**, or **Add customer** (for a forgotten customer; the receipt stays as printed).
  More items go on a new sale (**More items for …**).
- **Printing never affects the sale.** A failed print can be retried, and receipts can always be
  reprinted.
- **The audit log is append-only:** who, what, when, before and after.

**Desktop terminals and offline**
- **Saved locally first.** Every sale is saved in the terminal's SQLite database, then synced.
- **When it syncs:** about 1 s after each change, every 30 s otherwise, and on **Sync now**.
  - **Push:** sales, shifts and cash movements, in order.
  - **Pull:** prices, products, customers, users and PINs, settings.
  - **Top-up:** more stock allocation.
- **Without internet** the terminal keeps selling. Retries wait 5 s, 10 s, 20 s … up to 5 min.
  After **72 h** without a sync (Settings) it stops selling. Cashiers can sign in offline with
  their PIN.
- **Stock allocation:** each terminal holds a share of the free stock (90% split between
  terminals, set in Settings) and sells only that share.
  - Offline sales are never rejected. A shortage found at sync raises a **conflict** for a
    manager.
  - While terminals hold most of the stock, the back office can only remove what is left.
- **Safe to repeat:** every operation has a unique ID, so a repeated sync never counts twice.

**Stock and purchasing**
- **Products:** variants (SKUs), units and packs (for example a box of 12), barcodes, prices,
  batches and expiry.
- **Stock changes** go through documents (stock in, stock out, count). Adjustments need approval.
  Batches leave earliest-expiry first.
- **Purchasing:** purchase order → approve → receive, in one or more deliveries. Cost is the
  weighted average.

**Hardware (per computer, Hardware page)**
- **F4** opens the Point of Sale from any page (on the POS it returns to the scan box).
- **Scanner:** a USB barcode scanner is recognised by its typing speed, anywhere on the POS.
  Double reads are ignored, and unknown barcodes beep.
- **Printer:** 58 mm or 80 mm thermal printers, printed directly with ESC/POS on desktop, or A4
  and other printers through the print dialog.
- **Cash drawer:** opens through the receipt printer (desktop only). Opening it without a sale
  needs a reason and is audited.

**Roles and permissions**
- 34 permissions, grouped into roles: Owner, Store manager, Cashier, Inventory clerk, plus any
  custom roles.
- Nobody can grant more than they have. The store always keeps an owner.

**Customers:** regular, senior citizen and PWD customers (their ID number fills the 20%
VAT-exempt discount), and businesses (TIN and address printed on receipts). Each customer has a
purchase history.

**Settings and audit log:** the owner sets store details, receipt text, the drawer limit, the
terminal stock share, offline hours and expiry warnings. The owner and manager can read and
filter the audit log, and download it as CSV.

**Feedback:** saves show a pop-up confirmation. Desktop sync events (offline, back online,
conflicts) show as small toasts. Errors appear next to the form.

## 5. Deploy (cloud)

Use one domain with HTTPS: `api.<domain>` (Laravel + MySQL 8.4) and `app.<domain>` (Next.js,
`npm run build`, then `npm run start` under Node).

Backend `.env`:

```
APP_ENV=production
APP_DEBUG=false
FRONTEND_URL=https://app.<domain>
SANCTUM_STATEFUL_DOMAINS=app.<domain>
SESSION_DOMAIN=.<domain>
SESSION_SECURE_COOKIE=true
CORS_ALLOWED_ORIGINS=https://app.<domain>,http://tauri.localhost
COMPRIVA_OWNER_PASSWORD=<strong password>   # needed for db:seed outside local
```

Then run `php artisan migrate --force --seed`.

- **Frontend build:** build with `NEXT_PUBLIC_API_URL=https://api.<domain>`. The value is baked
  in at build time.
- **Desktop installer:** rebuild it with the same value and install it on each checkout PC.
- **Browsers** use the web POS online. Each selling browser is registered once as a terminal.

**Before going live**
- Upgrade to PHP 8.3+ and Laravel 13.
- Confirm the BIR receipt requirements with your accountant.
- Test real printers, scanners and drawers.

## 6. Troubleshooting

| Problem | Fix |
| ------- | --- |
| API errors, "connection refused" | Start MySQL (XAMPP) and `php artisan serve` |
| "Another next dev server is already running" | Stop the other `npm run dev` / `desktop:dev` |
| Can't remove stock that shows as in stock | Desktop terminals hold it as their allocation; lower the share in Settings |
| Scanner types into the wrong place or adds twice | Set the scanner to USB keyboard, US layout, suffix Enter (CR only) |
| Printer prints nothing or garbage | Choose the printer on the Hardware page; use the vendor driver or "Generic / Text Only"; match the paper width |
| Terminal stopped selling | It has been offline longer than the limit: connect it and press **Sync now** |
