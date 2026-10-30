# Compriva design system

Professional, minimal retail software: a clean light theme, strong type, consistent spacing,
subtle borders and Lucide icons. Tokens live in `frontend/src/app/globals.css`; shared components
live in `frontend/src/components`.

## 1. Color tokens

Light theme only (Phase 4 brief). Every pair below was contrast-checked. Body text is at least
4.5:1, and chart marks are at least 3:1 on the card surface.

### Brand: Compriva emerald

| Token | Hex | Use | Check |
| ----- | --- | --- | ----- |
| `brand-50` / `brand-100` | `#eef8f4` / `#d5eee5` | Tints, avatar background | — |
| `brand-500` (`chart-1`) | `#0d8a6c` | Chart series, inline magnitude bars | Passes the dataviz palette validator on white (lightness band, chroma ≥ 0.1, ≥ 3:1) |
| `brand-600` (`primary`) | `#0b7a60` | Buttons, links, focus ring, active icons | White text on it: 5.29:1 |
| `brand-700` | `#0a5c48` | Text on brand tints (active nav, accent) | 7.0:1 on `accent` |

### Surfaces and ink

| Token | Hex | Use |
| ----- | --- | --- |
| `background` | `#f6f7f7` | App canvas |
| `card`, `popover`, `sidebar` | `#ffffff` | Raised surfaces |
| `foreground` | `#111827` | Primary text (17.7:1) |
| `muted-foreground` | `#5b6670` | Secondary text (5.9:1 on white, 5.5:1 on canvas) |
| `muted` / `secondary` | `#f1f3f4` / `#eef1f2` | Quiet fills, tracks, skeletons |
| `accent` | `#e8f4f0` | Hover / selected tint |
| `border` / `input` | `#e4e7ea` / `#d9dee2` | Hairline borders, inputs |
| `chart-grid` | `#eceef0` | Chart gridlines (one step off the card) |

### Status (always icon + label, never color alone)

| Tone | Text | Soft background | Contrast | Fill (meters, marks) |
| ---- | ---- | --------------- | -------- | -------------------- |
| success | `#14713f` | `#e8f5ee` | 5.41:1 | `status-good` `#0ca30c` |
| warning | `#8a5300` | `#fdf3e1` | 5.75:1 | `status-warning` `#fab219` |
| danger | `#b42318` | `#fdecea` | 5.75:1 | `status-critical` `#d03b3b` |
| info | `#1d5fbf` | `#e9f1fc` | 5.36:1 | — |

Status colors are reserved for state and are never used as chart series colors.

### Chart series

`chart-1` is the brand series. `chart-2`…`chart-5` follow the validated categorical order of the
dataviz reference palette (orange `#eb6834`, blue `#2a78d6`, yellow `#eda100`, violet `#6250d6`).
Assign them in this fixed order and never cycle. Run the palette validator before adding series.

## 2. Typography

| Role | Style |
| ---- | ----- |
| Font | **Geist Sans**, self-hosted by `next/font` (works offline on terminals); Geist Mono for code |
| Page title (h1) | 24px semibold, tight tracking. One per page via `PageHeader` |
| Section / panel title | 15–16px semibold |
| Body | 14px (`text-sm` is the base) |
| Secondary / meta | 12–14px `muted-foreground` |
| KPI value | 28px semibold, proportional figures |
| Tables, axis ticks, numeric columns | `.numeric` utility = `tabular-nums`, so digits align |

Phase 4 fixed a Phase 0 bug: `--font-sans` referred to itself, so the app had been rendering in
the browser's fallback serif font.

## 3. Spacing, radius, elevation

- Tailwind 4px scale. Page gutters are 16px on phones, 24px on tablets and 32px on desktops.
  Gaps between sections are 24px, and between cards 16px.
- Cards: 20px padding (`--card-spacing`), 14px radius (`rounded-xl`), a 1px `border` ring and
  `shadow-card` (`0 1px 2px rgb(16 24 40 / 4%)`). Borders do the work; shadows stay barely there.
- Controls: 32px (`h-8`) default and 36px (`h-9`) for nav rows, with an 8–10px radius.
- Content width: at most 1400px, centered.

## 4. Layout

| Region | Behavior |
| ------ | -------- |
| **Sidebar** | 256px, fixed at ≥ 1024px (`lg`). Grouped sections: Sell · Stock · Insights · Administration. Permission-filtered. Unbuilt modules show "Soon" and are not links. Active item: brand tint + brand icon |
| **Mobile navigation** | Below 1024px the same nav opens in a left drawer (`Sheet`) from the header menu button, and closes on navigation |
| **Header** | 64px, sticky, translucent white. Breadcrumbs · offline badge (terminals) · notifications · user menu |
| **Breadcrumbs** | Generated from the navigation config: Home › group › page. Group labels are not links. Only the current page shows on phones |
| **Notifications** | Bell with a count badge. The popover lists low-stock and expiring alerts from the real stock-alerts endpoint |
| **User menu** | Avatar initials, name, role · My profile · System status (if permitted) · Sign out |
| **Main area** | `PageHeader`, then content in `Panel`s and grids. Grids always declare `grid-cols-1` so wide content can't widen the page (tested: no horizontal scroll at 390px) |

## 5. Components

| Component | File | Rules |
| --------- | ---- | ----- |
| `Brand` | `components/brand.tsx` | Logo mark (basket on brand square) + wordmark |
| `PageHeader` | `components/page-header.tsx` | Exactly one h1 per page; optional description and actions |
| `Panel` | `components/panel.tsx` | Standard container: title, description, header action, optional footer. `flush` for edge-to-edge tables. Footer only when it has content |
| `StatCard` + `Delta` | `components/stat-card.tsx` | KPI tile: label · value · optional meta · delta. Delta color = direction × whether up is good, always with arrow and signed % |
| `StatusBadge` | `components/status-badge.tsx` | Tone + icon + label, never color alone |
| `Meter` | `components/meter.tsx` | Severity fill on a same-hue lighter track, `role="meter"`, always next to the numbers |
| `SegmentedControl` | `components/segmented-control.tsx` | Single choice (date range, chart/table). One option always selected |
| `EmptyState` | `components/empty-state.tsx` | Says what is missing and why |
| `FormField` | `components/form-field.tsx` | Label + input + accessible error/hint |
| shadcn/ui (Base UI) | `components/ui/*` | button, card, badge, input, label, alert, separator, dropdown-menu, sheet, popover, table, skeleton, tooltip, avatar, breadcrumb, toggle-group |

Formatting helpers (`lib/format.ts`): `formatMoney` (exact, from decimal strings),
`formatMoneyCompact` (₱12.9K, ticks and tiles), `formatCount`, `formatQuantity`,
`formatPercentChange` (true minus sign), `formatDate/Time/Relative`, `initials`. These are display only.

## 6. Data visualization rules

Applied from the data-viz method used for this project:

- **Form first.** KPIs are stat tiles, not charts. Sales over time is a column chart with one
  series and no legend (the title names it). Best sellers is a ranked list with inline bars.
- **Marks.** Columns are at most 24px wide with 4px rounded data-ends and square baselines.
  Gridlines are hairline and solid (never dashed), and there is no axis line on the value axis.
- **Hover by default.** A tooltip leads with the value (with a short line key), then the label.
  The hovered column is highlighted.
- **A tooltip is never the only way to read a value.** Every chart has a Chart/Table toggle, and the
  figure has an `aria-label` summary.
- **Text never wears the data color.** Values and labels use text tokens.
- **Filters sit in one row above what they scope.** The dashboard date range scopes the sales
  section. Stock alerts are labelled as live and unaffected.
- **Refetch keeps the frame.** Skeletons appear only on first load.
- **Motion.** Chart entry animation (500ms) is skipped when the OS asks for reduced motion
  (`useReducedMotion`).

## 7. Dashboard

| Block | Data | Source |
| ----- | ---- | ------ |
| Today's sales, Transactions, Average transaction value, Gross profit (+ margin) | KPI + % change vs previous period | **Sample** (`modules/dashboard/sample-data.ts`) |
| Sales by hour / by day | Series per bucket | **Sample** |
| Best-selling products | Top 5 by sales | **Sample** |
| Recent transactions | Latest 8 | **Sample** |
| Low-stock alerts | On hand ≤ reorder level | **Real**: `GET /api/v1/dashboard/stock-alerts` |
| Expiring products | Batches within `inventory.expiry_warning_days` | **Real**: same endpoint |

Sample data is labelled on screen ("Sample sales data"). It is deterministic per day and range,
and follows the typed contract `SalesOverview` (`modules/dashboard/types.ts`) for the future
`GET /api/v1/dashboard/sales?range=today|7d|30d`. When that endpoint exists, only
`fetchSalesOverview()` in `modules/dashboard/api.ts` changes. All figures will then be computed by
the server; the UI formats and never calculates.

Who sees what: `dashboard.view` (Owner, Manager) gets the dashboard. Everyone else gets a welcome
page listing their modules. Stock alerts need `dashboard.view` or `inventory.view`.

## 8. Accessibility checklist

- Contrast verified for every token pair (section 1).
- Status is never color alone; the meter has `role="meter"` with values.
- Navigation landmarks, `aria-current="page"`, and a labelled breadcrumb `nav`.
- Every icon-only button has an `aria-label` (menu, notifications with count).
- Keyboard: Base UI menus, popovers and drawers are focus-managed; focus ring uses the `ring` token.
- Charts: `figure role="img"` with a summary, a table alternative, and reduced motion respected.
- Layout: no horizontal scrolling at 390px width (e2e test).
