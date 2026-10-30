# Phase 4: UI/UX and dashboard

Completed 2026-10-30. Reference: [design-system.md](design-system.md).

## Deliverables

| Requirement | Result |
| ----------- | ------ |
| Design system | Brand, surface, status and chart tokens (contrast-checked; chart color validated); Geist typography; spacing, radius and elevation rules; shared components |
| Sidebar | Grouped, permission-filtered, "Soon" for unbuilt modules; drawer below 1024px |
| Header | Sticky; breadcrumbs, offline badge, notifications, user menu |
| Breadcrumbs | Generated from the navigation config |
| User profile | Avatar menu (profile, system status, sign out); profile page uses the new page header |
| Notifications | Real stock alerts with count badge |
| Main content area | `PageHeader` + `Panel` grid, max 1400px |
| Dashboard | Today's sales, transactions, average transaction value, gross profit, low-stock alerts, expiring products, sales chart, best sellers, recent transactions |
| Mock data only where necessary | Sales figures are sample data (no sales exist yet); stock alerts are real |

## Changes

**Backend:** `GET /api/v1/dashboard/stock-alerts` (`StockAlerts` query, `StockAlertController`;
`dashboard.view` or `inventory.view`). This is a read-only query, not a business calculation.
The demo seeder now makes three SKUs low or out of stock and three perishables expire in 2, 3 and
5 days, so the alerts show realistic data. The dev database was re-seeded, which removed the
revoked test terminal T09.

**Frontend:**
- **Tokens:** rewrote `globals.css`, which also fixes the broken `--font-sans` from Phase 0.
- **Primitives:** shadcn `card` now uses the border token, a soft shadow and 20px padding. Added
  10 shadcn components.
- **Shared components:** `brand`, `page-header`, `panel`, `stat-card`, `status-badge`, `meter`,
  `segmented-control`, `empty-state`.
- **Utilities:** `lib/format.ts` and `lib/use-reduced-motion.ts`.
- **Layout:** `sidebar-nav`, `breadcrumbs`, `notifications`, `user-menu`, rewritten `app-shell`,
  and grouped `navigation.ts` with breadcrumb generation.
- **Dashboard module:** types (the future `SalesOverview` contract), sample data, API, shared
  stock-alerts store, chart, best sellers, recent transactions, stock panels, page.
- **Pages:** home is the dashboard for `dashboard.view` and a welcome page otherwise. Diagnostics
  moved to `/system` (`settings.manage`).

**E2E infrastructure:** a Playwright `setup` project signs in each demo account once and stores the
session in `playwright/.auth/` (git-ignored). Signing in per test had exceeded the server's login
rate limit, which stays on.

## Verification

| Check | Result |
| ----- | ------ |
| `php artisan test` | 111 passed (3 new: stock alerts ordering and filters, expiry window, permissions) |
| `npm test` | 61 passed (new: formatters, grouped navigation and breadcrumbs, sample data contract, KPI delta semantics) |
| `npm run lint` / `typecheck` / web build / desktop static export | pass (`/system` included in the export) |
| `npm run test:e2e` | 15 passed: 3 setup sign-ins; dashboard (KPIs, chart bars, table view, best sellers, transactions, real stock alerts), date range, header (notification count 6, user menu, breadcrumbs), cashier welcome, phone layout (no horizontal scroll, drawer navigation), auth, system status |
| Visual review | Desktop (1440px) and phone (390px) screenshots reviewed. Fixed: clipped best-seller values, empty panel footers, page wider than a phone, chart restarting its animation on resize (now honours reduced motion) |

## Notes

- **Stale dev styles:** `next dev` served stale CSS from its Turbopack cache (`.next/dev`) after
  `globals.css` was rewritten. If styles look wrong in development, stop the dev server and
  delete `frontend/.next/dev`.
- **"N" button in dev:** the Next.js dev "insight" overlay appears in development only. It is the
  instant-navigation hint described in Phase 3.
- **Light theme only, as briefed.** The tokens are structured so a dark theme can be added as a
  second set of values later.
