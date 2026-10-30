# Point of sale

How checkout works: terminals, shifts, how a cart is priced, payments, how a sale is recorded,
voids, returns, receipts, and the endpoints. Stock changes go through the stock ledger described in
[products-inventory.md](products-inventory.md).

## 1. Transaction workflow

| Step | Where |
| ---- | ----- |
| 1. Open the cashier shift | `POST /pos/shift`: opening cash counted into the drawer |
| 2–4. Scan or search, add items, adjust quantities and units | POS screen; the cart stays on the terminal |
| 5. Discounts | Item discounts, one sale discount (preset such as Senior Citizen, or manual) |
| 6. Taxes | Shared calculator (§3), on the screen and again on the server |
| 7–8. Choose and validate payment | Cash, GCash, Maya, split; `TenderCalculator` (§5) |
| 9–10. Complete, deduct stock | `POST /pos/checkout`: one database transaction (§6) |
| 11. Receipt | Returned by checkout; printed from the browser or desktop app (§9) |

## 2. Terminals

Every sale, shift and receipt number belongs to a **terminal** (`devices` row, code `T01`, `T02`, …).

- Each client sends its install ID in `X-Compriva-Device`: the desktop app's from
  `src-tauri/src/device.rs`, a browser's from local storage (`compriva.install_id`, created by
  `src/platform/web.ts`).
- The first time the POS opens on a computer, a user with `devices.manage` registers it with one
  click (`POST /pos/terminal`). It gets the next free code and is active immediately.
- Clearing a browser's site data gives it a new install ID; it must then be registered again.
- POS requests from an unknown client return `TERMINAL_REQUIRED`; a revoked terminal returns
  `DEVICE_REVOKED`.

## 3. Calculations

All money arithmetic is integer: amounts in centavos, quantities, prices and rates in 1/10 000
units. There is no floating point anywhere in the calculation (`FixedPoint.php`, `fixed-point.ts`).
Every division rounds half away from zero.

The same algorithm runs in two places:

- `backend/app/Domain/Sales/Pricing/CartCalculator.php`, which decides what is charged.
- `frontend/src/modules/pos/calculator.ts`, so the screen shows the exact same total.

Both are tested against the hand-checked cases in `shared/fixtures/checkout-calculations.json`.

Per line:

1. **Gross** = quantity × unit price, rounded to centavos.
2. **Item discount**: a percentage of the gross, or a fixed amount capped at the gross.
3. **Sale discount**, computed on what is left after item discounts, then split across lines in
   proportion. The split uses the largest remainder method, so the shares add up to the exact
   centavo; leftover centavos go to the earlier line. A maximum amount caps it, and a sale can
   never go below zero.
4. **VAT**:
   - VAT-inclusive prices: the VAT is extracted, `taxable = round(total ÷ 1.12)` and
     `VAT = total − taxable`.
   - Exclusive prices: VAT is added on top.
   - VAT-exempt, zero-rated and non-VAT lines carry no VAT.

**Senior Citizen and PWD** (seeded `SC20`, `PWD20`; `is_vat_exempt`):

- The VAT is removed first, then the 20% is taken from the VAT-exclusive amount. The lines become
  VAT-exempt.
- The customer's ID number is required.
- Cannot be combined with item discounts. Cashiers may apply it without approval.

Sale totals:

```
gross − discounts − VAT exemption = vatable sales + VAT + VAT-exempt sales + zero-rated sales = grand total
```

Every centavo of the grand total is in exactly one tax bucket; a test checks this for every case.
The receipt's "Less VAT (exempt)" amount is derived from the stored lines.

## 4. Shifts

- At most one open shift per terminal (a unique index), and one per cashier.
- Only the shift's cashier sells on it. The POS shows "terminal in use" to anyone else; a user with
  `cashier.manage_shifts` can close it.
- **Closing** counts the drawer:

  ```
  expected cash = opening cash + cash sales − cash refunds + cash in − cash out − cash drops
  ```

  - Cash sales are what the sales kept (tendered − change). Voided sales are excluded.
  - The count and the difference (`cash_variance`) are stored. A closed shift is frozen by triggers.
- `GET /pos/shift` shows the running summary: sales, totals per method, refunds and expected cash.

## 5. Payments

The store accepts **Cash, GCash and Maya** only; card and bank transfer are switched off.

| Method | Rules |
| ------ | ----- |
| Cash | May be more than due; the change comes out of cash. Cannot be switched off |
| GCash, Maya | Paid by scanning the store's QR code shown on the POS. The amount must be exact (never more than due), and the reference number from the customer's confirmation is required |

- A manager uploads each QR code and the account name and number on **Payment methods**
  (`payments.manage_methods`). Images are kept on the private disk and served by
  `GET /media/payment-qr/{id}`.
- **Split payment**: any mix of tenders, applied with non-cash first.
- Every tender must keep a positive amount; an unneeded extra tender is refused.
- Change comes from the last cash tender first. Each `payments` row stores the amount applied,
  the amount tendered and the change.
- A free sale (total ₱0, e.g. a 100% discount) takes no payment.

## 6. Recording a sale

`POST /pos/checkout` (`CompleteSale`):

1. **Duplicate protection.** The POS generates the sale ID (UUIDv7) when the cart starts, and
   keeps it through retries.
   - Sending the same sale again returns the first one (`200`, `meta.replayed: true`), even after
     a timeout or a double click.
   - Two simultaneous requests for the same sale are serialized by the terminal's row lock; the
     second gets the first sale back.
   - The same ID from another terminal is a `409`.
2. **Repricing.** The server prices the cart again from the database. The client sends only SKU,
   unit, quantity, a manager-approved price override and discounts. If the result differs from
   `expected_total`, nothing is saved (`TOTAL_MISMATCH`), and the POS reloads the prices.
3. **Approval**: see §7.
4. **One database transaction**:
   - The receipt number: the terminal's next number (`T01-000123`) under a row lock.
   - The sale, with totals and a customer snapshot.
   - A snapshot of each line: product name, SKU code, scanned barcode, unit, conversion factor,
     regular and charged price, cost, tax code, type and rate, and amounts.
   - Stock deducted through `StockLedger::sell`, earliest-expiring batches first. One `sale`
     movement per batch, referencing the sale line.
   - Discount rows and payment rows.

   Not enough stock (`INSUFFICIENT_STOCK`) or any other failure rolls everything back, including
   the receipt number.
5. **Preserved forever.** Sales, items, discounts and payments cannot be updated or deleted:
   triggers block it, and so do the models. The only change a sale allows is completed → voided.

## 7. Approvals, voids and returns

| Action | Permission | Cashier role |
| ------ | ---------- | ------------ |
| Manual item or sale discount, or a preset marked `requires_approval` | `pos.apply_discount` | Needs approval |
| Price change on a line | `pos.price_override` | Needs approval |
| Void a sale | `sales.void` | Needs approval |
| Return items | `sales.return` | Needs approval |

**Manager override.** Without the permission the API answers `APPROVAL_REQUIRED` (403) with the
permission in `details`.

- The POS then asks for a manager's username and PIN (or password), and resends them as
  `approval: { login, secret }`.
- Every approval and refusal is audited. The approver is stored on the record:
  `sale_discounts.approved_by`, `sale_items.price_override_by`, `sales.voided_by` and
  `sale_returns.approved_by`.

**Void** (`POST /sales/{id}/void`, with a reason):

- Cancels a whole sale while its shift is still open and nothing has been returned.
- The sale keeps its amounts; only its status changes.
- Stock goes back to the same batches at the same cost (`sale_void` movements).
- A sale from a closed shift must be returned instead.

**Return** (`POST /sales/{id}/returns`):

- Some or all of the items, with a condition for each, a reason and a refund method (Cash,
  GCash, Maya; e-wallet refunds need a reference).
- Needs an open shift on this terminal, because a cash refund leaves this drawer.
- **Refunds** are what was paid for the line after discounts, pro rata. The last return of a line
  refunds exactly what is left, so a line's refunds always add up to its total.
- You cannot return more than was sold minus what was already returned.
- Resellable items go back to stock (`sale_return` movements, into the batches the line came from
  while they have room). Damaged or expired items are recorded without restocking.
- Returns are numbered `RET-000001`.

## 8. Held carts

"Hold" parks the cart under a name so the next customer can be served; "Held carts" resumes it.

- Carts never leave the terminal ([offline-sync.md](offline-sync.md) §1). Held carts live in the
  terminal's local storage, per terminal, behind `held-carts.ts`.
- A resumed cart gets a new sale ID.
- Prices are checked again at checkout; a changed total is caught by `TOTAL_MISMATCH`.

## 9. Receipts

- The receipt is rendered from the sale's stored snapshot, never recalculated (`Receipt`).
- It includes the store header (name, address, TIN), the receipt number, terminal and cashier, the
  lines with discounts, the totals, and the payments with references and change.
- The VAT breakdown (VATable, VAT, exempt, zero-rated) is shown when the `receipt` setting allows.
- It also shows the SC/PWD ID and a VOID mark.
- Printing uses `window.print()` with a print stylesheet that shows only the receipt at 80 mm
  width; this works in browsers and in the desktop app.
- Reprints are recorded in the audit log (`sales.reprint`).

BIR requirements (machine registration, official receipt wording, Z-readings) still need to be
confirmed with the store's accountant before production.

## 10. Ready for offline checkout

Checkout today is online. These choices let the desktop app sell from SQLite later without
changing the rules:

- The sale ID is generated by the client, and replaying it is harmless: the same idempotency the
  sync outbox will rely on.
- Pricing and payment rules exist as pure functions on both sides, tested by the same fixtures. The
  terminal can price and validate a sale with no server.
- Carts and held carts are terminal-local.
- The receipt numbering is per terminal, matching the per-terminal counter in
  [offline-sync.md](offline-sync.md) §8.
- Stock deduction is one `StockLedger::sell` call per line; synced offline sales will post through
  the same call.

## 11. API

All endpoints are under `/api/v1`. POS endpoints need `pos.access` and the `X-Compriva-Device`
header.

| Method | Path | Permission | Notes |
| ------ | ---- | ---------- | ----- |
| GET | `/pos/terminal` | pos.access | Bootstrap: terminal (or null), open shift, payment methods, preset discounts, categories, receipt settings |
| POST | `/pos/terminal` | pos.access + devices.manage | Register this client as the next terminal. `name` |
| GET | `/pos/shift` | pos.access | Open shift on this terminal with its summary |
| POST | `/pos/shift` | pos.access + cashier.shift | Open a shift. `opening_float` |
| POST | `/pos/shift/close` | shift owner or cashier.manage_shifts | `counted_cash`; returns expected cash and variance |
| GET | `/pos/catalog?q=&barcode=&category_id=` | pos.access | Sellable items with units, current prices, tax and stock. `barcode` is an exact scan and sets `matched_unit_id` |
| POST | `/pos/quote` | pos.access | Prices a cart on the server; lists the approvals it needs |
| POST | `/pos/checkout` | pos.access | `id`, `lines[]`, `discount`, `payments[]`, `expected_total`, `customer_name`, `approval`. 201, or 200 when replayed |
| GET | `/pos/sales?q=` | pos.access | This shift's sales, or a receipt-number search |
| GET | `/sales?q=&status=&from=&to=` | sales.view | Paginated sales history |
| GET | `/sales/{id}` | sales.view or pos.access | Sale with everything the receipt needs |
| POST | `/sales/{id}/reprint` | sales.reprint | Audited; returns the receipt |
| POST | `/sales/{id}/void` | sales.void or approval | `reason`, `approval` |
| POST | `/sales/{id}/returns` | sales.return or approval | `items[]` (`sale_item_id`, `quantity`, `condition`), `reason`, `refund_method`, `refund_reference`, `approval` |
| GET | `/payment-methods` | signed in | Cash, GCash, Maya with QR URL and account details |
| PATCH | `/payment-methods/{id}` | payments.manage_methods | `account_name`, `account_number`, `is_active` (cash stays on) |
| POST, DELETE | `/payment-methods/{id}/qr` | payments.manage_methods | Upload (PNG/JPEG/WebP, ≤ 2 MB) or remove the QR code |
| GET | `/media/payment-qr/{id}` | public | QR image for `<img>` tags |

Errors: `TERMINAL_REQUIRED`, `SHIFT_REQUIRED`, `APPROVAL_REQUIRED`, `TOTAL_MISMATCH`,
`INSUFFICIENT_STOCK`, and `VALIDATION_FAILED` with field paths such as `payments.0.reference` or
`lines.2.quantity` ([error-handling.md](error-handling.md)).

## 12. User interface

| Page | Path | Shows |
| ---- | ---- | ----- |
| Point of Sale | `/pos` | Terminal setup, opening a shift, then the register: scan box, category chips, item grid, cart (quantity steppers, units, item and sale discounts, totals), payment, receipt. Held carts, this shift's sales and closing the shift are in the header |
| Sales | `/sales` | History with search, status and date filters |
| Sale | `/sales/view?id=` | Receipt, reprint, void and return |
| Payment methods | `/payment-methods` | GCash and Maya QR codes and account details; switching methods on and off |

The scan box keeps focus. A barcode scanner types the code and presses Enter; one match is added
straight to the cart in the scanned unit (a box barcode adds a box).
