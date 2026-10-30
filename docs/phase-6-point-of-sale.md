# Phase 6: Point of sale and sales engine

Completed 2026-10-30. Reference: [point-of-sale.md](point-of-sale.md).

## Deliverables

| Requirement | Result |
| ----------- | ------ |
| Barcode scanning, search, categories, selection | Scan box (Enter adds a single match in the scanned unit, e.g. a box barcode), name and SKU search, category chips, item grid with price and stock |
| Cart, quantities, units | Steppers for count units, decimals for weighed units, unit switch per line, line editor |
| Discounts | Item discounts (% or ₱), one sale discount: Senior Citizen and PWD (VAT-exempt, ID required) or manual |
| Subtotal, tax, total | Shared integer calculator on screen and server; VAT-inclusive, exclusive, exempt and zero-rated |
| Payment methods | Cash, GCash, Maya only (per the store's decision); GCash and Maya by the store's QR code with a reference number; split payments |
| Change | From cash only; shown live and stored per tender |
| Open cashier shift | Opening cash; one shift per terminal and per cashier; close with a drawer count and variance |
| Validate payment, complete, deduct inventory | One transaction: receipt number, snapshots, `StockLedger::sell` (FEFO), discounts, payments |
| Receipt | Printable 80 mm receipt from the stored snapshot; reprint is audited |
| Backend calculations, no floating point | Integer centavos (`FixedPoint`); the server reprices every cart and refuses a different total |
| Prevent duplicate transactions | Client-generated sale ID; replays return the first sale |
| Product and tax snapshots | Name, SKU, barcode, unit, factor, regular and charged price, cost, tax code, type and rate per line |
| Database transactions | Checkout, void and return each run in one transaction with row locks |
| Held transactions | Hold and resume carts on the terminal |
| Authorized voids and returns | Manager approval on the cashier's screen; voids while the shift is open; partial returns with exact pro-rata refunds |
| Preserve completed sales | Triggers and models block updates and deletes; a void only changes the status |
| Offline preparation | Pure calculators on both sides with shared fixtures, client IDs, terminal-local carts, per-terminal numbering |

## Changes

**Backend**
- Migration `2026_11_01_100000_prepare_point_of_sale`:
  - Adds `qr_image_path`, `account_name` and `account_number` to `payment_methods`.
  - Switches off every method except cash, GCash and Maya. The seeder no longer creates card and
    bank transfer.
- Pricing: `FixedPoint`, `CartCalculator`, `TenderCalculator`.
- Services: `CartPricer` (catalog → priced lines and snapshots), `SupervisorApproval`, `Terminals`.
- Actions:
  - Sales: `CompleteSale`, `VoidSale`, `ProcessReturn`.
  - Cashiering: `ManageShifts`, plus the `ShiftSummary` query.
  - Payments: `ManagePaymentMethods`.
- `StockLedger` gains `sell`, `reverseSale` and `restockReturn`. Movements reference the sale or
  return line (new morph aliases `sale_item` and `sale_return_item`).
- Controllers: `PosController`, `SaleController` and `PaymentMethodController`, with 18 routes plus the
  public QR image route.
- Error codes: `TERMINAL_REQUIRED`, `SHIFT_REQUIRED`, `APPROVAL_REQUIRED`, `TOTAL_MISMATCH`.

**Frontend**
- `modules/pos`:
  - Logic: the fixed-point helpers, calculator, tender rules, cart functions, cart store, held carts
    and API.
  - 12 components: POS page, terminal setup, register, item browser, cart, line and sale discount
    dialogs, payment, approval fields, close shift, receipt, and the Payment methods page.
- `modules/sales`: the Sales history and sale pages, with void and return.
- Routes:
  - New: `/pos`, `/sales`, `/sales/view`, `/payment-methods`.
  - Sidebar: Point of Sale and Sales are enabled; Payment methods is added under Administration.
- The web platform now has a browser terminal ID (`compriva.install_id` in local storage), sent as
  `X-Compriva-Device` like the desktop install ID.
- The print stylesheet prints only the receipt.

**Shared**
- `shared/fixtures/checkout-calculations.json`: 9 hand-checked carts, used by both test suites.

## Verification

| Check | Result |
| ----- | ------ |
| Backend tests | 186 passed. New: `CartCalculatorTest` (21), `CheckoutTest` (14) and `VoidReturnShiftTest` (8). Pint passes |
| Frontend unit tests | 100 passed. New: the calculator, fixed-point and tender tests (23, the same 9 fixture cases as PHP), and cart tests (5) |
| Typecheck, lint | Clean |
| Builds | Web build and desktop static export both succeed (23 pages) |
| End-to-end | 21 passed. The new `pos.spec.ts` (3 tests) covers the steps below |
| Layout | POS and payment checked at 1440 px and 390 px with no horizontal overflow; on phones the cart stacks under the items |

The new end-to-end tests cover:

1. Registering the terminal.
2. Opening a shift.
3. A cash sale with change.
4. A GCash + cash split with a reference number.
5. A manager-approved item discount.
6. Holding and resuming a cart.
7. A manager-approved void.
8. Closing the shift with a count.
9. The Payment methods page offering only Cash, GCash and Maya.

**Bugs found and fixed while testing**
- The VAT divisor was 100 times too large; the shared fixture caught it before any sale was made.
- An optional sale discount triggered "type required" when absent.
- The phone-layout end-to-end test needed a keyboard step because the dev-only Next.js badge
  covers the bottom of the drawer.

**Notes**
- The e2e browser is registered once as a terminal (fixed install ID), and its runs add sales to the
  local database. `php artisan migrate:fresh --seed` resets it.
- Upload the store's real GCash and Maya QR codes on **Payment methods** before going live.
- BIR receipt and Z-reading requirements still need the accountant's confirmation (§9 of the
  reference).
