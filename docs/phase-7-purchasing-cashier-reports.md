# Phase 7: Purchasing, cashier and reports

Completed 2026-10-30. Reference: [purchasing-cashier-reports.md](purchasing-cashier-reports.md).
Desktop synchronization is not started, as instructed.

## Deliverables

| Requirement | Result |
| ----------- | ------ |
| Suppliers | List with search, open orders, purchased total and last delivery; create and edit; automatic codes |
| Purchase orders and items | Draft → ordered → partially received → received / cancelled; lines per supplier unit; server-side totals |
| Partial receiving, goods receipts | One receipt per delivery; open quantities stay on the order; over-receipt refused; batch and expiry rules |
| Purchase history | Every delivery, filterable; per order and per supplier |
| Cost tracking | Cost per delivery against the ordered cost and per base unit; latest and weighted average cost updated by every delivery |
| Open shift, opening cash | From Phase 6 |
| Cash-in, cash-out | Cash in, cash out and cash drop on the open shift; manager approval for cashiers; cannot take out more than is in the drawer |
| Cash sales, expected cash, actual cash, closing, variance | Shift summary and closing dialog show each part of the expected cash; the counted cash and variance are stored; shift history for managers |
| Daily, weekly, monthly sales | `sales` report grouped by day, week or month |
| Product sales, category sales | Both reports, including returns |
| Gross profit, COGS | Dedicated reports, plus profit columns on the sales, product and category reports |
| Inventory valuation | At average cost and at retail |
| Stock movement | Opening, received, sold, returned, adjusted, closing from the ledger |
| Expiring products | Batches expired or expiring within N days, with cost at risk |
| Cashier performance | Sales, average sale, voids, refunds, cash over/short per cashier |
| Payment summaries | Per method with refunds and share |
| PDF, Excel, CSV | Every report, from the same data as the screen |
| Permissions | Purchasing and cashier permissions per route and per action; cost and profit behind `reports.view_profit` |

## Changes

**Backend**

No migration was needed: the purchasing and cash movement tables are from Phase 2.

- **New dependency:** `dompdf/dompdf` ^3.1, for PDF reports.
- **Purchasing:** `ManagePurchaseOrders`, `ReceiveGoods`, and `StockLedger::receive`. Purchase
  receipts post through the ledger like every other stock change.
- **Cashiering:** `RecordCashMovement`; shift resources now list the cash movements.
- **Reporting:**
  - Core: `Report`, `ReportResult`, `ReportFilters`, `ReportCatalog`, and the `Dec` exact-decimal
    helpers.
  - Queries: `DailySales`, `ProductSales`.
  - Ten report classes.
  - Exports: `ReportExporter` (CSV, XLSX, PDF), `ZipWriter`, and the Blade view `reports/pdf`.
- **Controllers:** `PurchasingController`, `ShiftController`, `ReportController`, and
  `PosController::cashMovement`. 18 new routes.
- **CORS:** `Content-Disposition` is exposed so the web app can name downloads.

**Frontend**

- **`modules/purchasing`:** orders, order form, order view with the receive panel, suppliers, and
  purchase history, delivery and cost history pages.
- **`modules/reports`:** the reports page (report list, period presets, group by, export buttons),
  a generic report table, and cell formatting on exact decimal strings.
- **`modules/pos`:** the cash in/out dialog, the shift history page, and an itemised expected cash
  in the closing dialog.
- **API client:** a `download()` method for file responses, which also reads JSON error bodies
  sent as blobs.
- **Navigation:** Purchasing and Reports are enabled; Cashier shifts is added under Sell.

## Verification

| Check | Result |
| ----- | ------ |
| Backend tests | 198 passed. New: `PurchasingTest` (5) and `ReportsAndCashTest` (7) |
| Frontend unit tests | 102 passed (new: report cell formatting) |
| Typecheck, lint | Clean |
| Builds | Web build and desktop static export both succeed (33 pages) |
| End-to-end | 24 passed. New `purchasing-reports.spec.ts`: supplier → order → place → receive in two deliveries at different costs → cost history (₱442.80 ÷ 12 = ₱36.90 per piece) → purchase history; payment summary on screen and exported as CSV, Excel and PDF; monthly sales with profit; shift history |
| Exports checked by hand | Python `zipfile.testzip()` passes on generated `.xlsx` files; the PDF renders cleanly (see below) |
| Layout | Reports, purchasing, order and shifts pages at 1440 px and 390 px with no page overflow; wide reports scroll inside their panel |

**`ReportsAndCashTest`** checks the reports against one worked day:

- Two sales, one void and one return.
- Revenue ₱535.72, COGS ₱455.00, gross profit ₱80.72, margin 15.1%.
- Payment shares 8.3% (cash) and 91.7% (GCash).
- Closing stock 87.
- Inventory value ₱3,045.00 at cost and ₱4,350.00 at retail.
- Profit columns are hidden from a reports-only role.
- The `.xlsx` is read back through its ZIP directory with CRC checks, and the PDF starts with `%PDF-`.

**`PurchasingTest`** checks:

- A partial delivery at a new cost: weighted average ₱35.3571 and latest cost ₱38.3333.
- Over-receipt is refused, and the order completes on the second delivery.
- Batch and expiry rules, and permission boundaries for the inventory clerk.

**The PDF, checked by hand:** inventory valuation in landscape with grouped numbers, aligned columns
and a bold totals row.

**Bugs found and fixed while testing**
- The daily sales query reused a variable name, which broke the daily totals.
- `lines` is a reserved word in MariaDB and cannot be a column alias.
- The goods receipt import was missing in the ledger (CRLF line endings defeated a scripted edit).
- After a delivery, the receive form kept the previous quantities. It is now keyed by what has
  arrived, so it resets.
- Product names were truncated on phones in the order and delivery views; they now wrap.
