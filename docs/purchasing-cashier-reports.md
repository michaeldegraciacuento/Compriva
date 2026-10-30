# Purchasing, cash management and reports

How buying stock, the cash drawer and the reports work, which endpoints exist, and who may use
them. Stock changes go through the stock ledger ([products-inventory.md](products-inventory.md)).
Shifts and sales are described in [point-of-sale.md](point-of-sale.md).

## 1. Purchasing

```
Supplier ──< Purchase order (PO-000001) ──< order lines (SKU, unit, quantity, cost)
                     │
                     └──< Goods receipt (GR-000001, one per delivery) ──< received lines ──> stock
```

| Step | Who | What happens |
| ---- | --- | ------------ |
| Supplier | `purchasing.manage` | Code `SUP-0001` given automatically; payment terms in days (0 = cash on delivery) |
| Draft order | `purchasing.manage` | Lines in the supplier's unit (case, box) with a cost per that unit. Totals computed on the server in integer centavos |
| Edit | `purchasing.manage` | Drafts only |
| Place order | `purchasing.approve` | `draft → ordered`. The order is frozen and can now be received |
| Receive | `purchasing.receive` | See below |
| Cancel | `purchasing.manage` | Only before anything was delivered |

**Receiving** (`ReceiveGoods`):

- One delivery is one goods receipt. Enter what actually arrived; lines left at 0 stay open.
- The order moves `ordered → partially_received → received`.
- More than is still expected is refused; extra goods go in with a stock-in.
- Batch-tracked products need a batch number and expiry-tracked products need an expiry date
  (same rules as stock-in).
- The actual cost may differ from the order. Both are kept, and the actual cost is what counts.
- One transaction: the receipt and its lines are written, then `StockLedger::receive` posts it:
  - stock goes up, with one `purchase_receipt` movement per line;
  - batches are created or topped up (linked to the receipt line);
  - the weighted average cost is updated;
  - the SKU's latest cost becomes cost ÷ conversion factor.

  The receipt is then frozen by triggers.

**Purchase history and cost tracking**

- **Purchase history** (`GET /goods-receipts`): every posted delivery, with filters.
- **Cost history** (`GET /skus/{id}/cost-history`): for each delivery of a product, the cost per
  received unit, the cost on the order, and the cost per base unit. It also shows the latest cost
  and the current weighted average cost.
- The supplier list shows each supplier's open orders, total purchased and last delivery.

## 2. Cash management

A shift is opened with the counted **opening cash** and closed with the counted **actual cash**
([point-of-sale.md](point-of-sale.md) §4). Between the two, money can move outside sales:

| Type | Example | Effect on expected cash |
| ---- | ------- | ----------------------- |
| Cash in | Coins brought from the office | + |
| Cash out | A small expense paid from the drawer | − |
| Cash drop | Excess cash moved to the safe | − |

- `POST /pos/cash-movements` records a movement on this terminal's open shift.
- Needs `cashier.cash_movements`, or a manager's approval on the cashier's screen (cashiers do not
  hold it).
- Only the shift's cashier, or a user with `cashier.manage_shifts`, can record one.
- Cash out and drops cannot exceed the cash that should be in the drawer.
- Movements are append-only.

```
expected cash = opening cash + cash sales − cash refunds + cash in − cash out − cash drops
cash variance = actual (counted) cash − expected cash      (negative = short)
```

- Cash sales are what sales kept (tendered − change); voided sales are excluded.
- **Cashier shifts** (`/shifts`, `cashier.manage_shifts`) lists every shift with sales, expected
  and counted cash, and over/short. Each shift opens to its full summary and cash movements.

## 3. Reports

`GET /reports` lists the reports the user may run. `GET /reports/{key}` returns the report;
add `?format=csv|xlsx|pdf` for a file.

**Filters**

- `from` / `to` are inclusive store business days (Asia/Manila). The default is the first of this
  month to today; the maximum is 400 days.
- `group` = `day` | `week` (Monday start) | `month`.
- `days` = look-ahead for expiry; the default is the `inventory.expiry_warning_days` setting.

| Report | Key | Shows |
| ------ | --- | ----- |
| Daily / weekly / monthly sales | `sales` | Transactions, gross sales, discounts, net sales, refunds, net after refunds, VAT, average sale; COGS, gross profit and margin\* |
| Product sales | `product-sales` | Quantity sold and returned (base units), sales, refunds, net; COGS, gross profit, margin\* |
| Category sales | `category-sales` | Products sold, sales, refunds, net, share of sales; COGS, gross profit, margin\* |
| Gross profit | `gross-profit` | Revenue without VAT, COGS, gross profit, margin per day, week or month (needs `reports.view_profit`) |
| Cost of goods sold | `cogs` | Net quantity, average cost per base unit, COGS and share per product (needs `reports.view_profit`) |
| Payment summary | `payment-summary` | Per method (Cash, GCash, Maya): payments, collected, change given, refunded, net, share |
| Cashier performance | `cashier-performance` | Shifts, transactions, sales, average sale, lines per sale, voids, refunds processed, cash over/short, unbalanced shifts |
| Inventory valuation | `inventory-valuation` | On hand now, retail price and value at retail; average cost, value at cost, potential profit\* |
| Stock movement | `stock-movement` | Per product: opening, received, sold (net of voids), returned, adjusted, closing |
| Expiring products | `expiring-products` | Batches with stock that have expired or expire within N days, with days left and cost at risk\* |

\* Cost and profit columns are removed for users without `reports.view_profit`. The two
profit-only reports are hidden from them.

**Definitions**

```
net sales      = Σ grand total of completed sales (voided sales excluded)
refunds        = Σ returns processed in the period (by the return's business day)
revenue        = (net sales − sales VAT) − (refunds − refund VAT)          VAT-exclusive
COGS           = Σ (cost per sold unit × quantity) on sale lines − cost of goods returned to stock
gross profit   = revenue − COGS
margin         = gross profit ÷ revenue
```

- The cost per sold unit is the snapshot taken at sale time: the weighted average or batch cost
  ([point-of-sale.md](point-of-sale.md) §6).
- Damaged or expired returns are refunded but not restocked, so their cost stays in COGS.

**Exact numbers**

- Database sums of DECIMAL columns are exact. Reports keep them as decimal strings and use
  bcmath (`Dec`) for differences, ratios and rounding (half away from zero).
- No floating point anywhere. Money has 2 decimals, quantities up to 4, percentages 1.

**Exports** (`ReportExporter`): the same columns, rows and totals as the screen.

| Format | Details |
| ------ | ------- |
| CSV | UTF-8 with BOM so Excel shows ñ correctly. Numbers are plain (`1234.50`) |
| Excel (.xlsx) | Numbers are stored as numbers with display formats (`#,##0.00`, `0.0"%"`). Title, frozen header row, bold totals |
| PDF | A4 (landscape for wide reports), store header, grouped numbers, totals, notes. Rendered by dompdf with DejaVu Sans |

- This PHP build has no `zip` extension, so the `.xlsx` package is written by a small ZIP writer
  (`ZipWriter`, deflate via zlib). A test reads the archive back through its central directory and
  checks every CRC and that every part is well-formed XML.
- Every export is recorded in the audit log (`report.exported`).

## 4. Permissions

| Permission | Owner | Manager | Cashier | Inventory clerk |
| ---------- | :---: | :-----: | :-----: | :-------------: |
| purchasing.view | ✓ | ✓ | | ✓ |
| purchasing.manage (suppliers, draft orders, cancel) | ✓ | ✓ | | |
| purchasing.approve (place orders) | ✓ | ✓ | | |
| purchasing.receive (receive deliveries) | ✓ | ✓ | | ✓ |
| cashier.shift (open / close own shift) | ✓ | ✓ | ✓ | |
| cashier.cash_movements (cash in / out / drop) | ✓ | ✓ | approval | |
| cashier.manage_shifts (shift history, close any shift) | ✓ | ✓ | | |
| reports.view | ✓ | ✓ | | |
| reports.view_profit (cost, profit, margin) | ✓ | ✓ | | |

Roles can be changed under roles management. The API checks every permission; the UI only hides
what the user cannot do.

## 5. API

| Method | Path | Permission | Notes |
| ------ | ---- | ---------- | ----- |
| GET | `/suppliers?q=&status=` | purchasing.view | With open orders, purchased total, last delivery |
| POST, PATCH | `/suppliers`, `/suppliers/{id}` | purchasing.manage | `code` optional (auto `SUP-0001`) |
| GET | `/purchase-orders?q=&status=&supplier_id=` | purchasing.view | |
| GET | `/purchase-orders/{id}` | purchasing.view | Lines with received and remaining quantities, deliveries |
| POST | `/purchase-orders` | purchasing.manage | `supplier_id`, `expected_date`, `notes`, `items[]` (`sku_id`, `unit_id`, `quantity`, `unit_cost`) |
| PUT | `/purchase-orders/{id}` | purchasing.manage | Drafts only |
| POST | `/purchase-orders/{id}/approve` | purchasing.approve | Places the order |
| POST | `/purchase-orders/{id}/cancel` | purchasing.manage | `reason`; before any delivery |
| POST | `/purchase-orders/{id}/receive` | purchasing.receive | `supplier_reference`, `lines[]` (`purchase_order_item_id`, `quantity`, `unit_cost`, `batch_number`, `expiry_date`) |
| GET | `/goods-receipts?q=&supplier_id=&from=&to=`, `/goods-receipts/{id}` | purchasing.view | Purchase history |
| GET | `/skus/{id}/cost-history` | purchasing.view | Cost tracking |
| POST | `/pos/cash-movements` | pos.access + cashier.cash_movements or approval | `type`, `amount`, `reason`, `approval` |
| GET | `/shifts?status=&from=&to=`, `/shifts/{id}` | cashier.manage_shifts | Shift history with summary and cash movements |
| GET | `/reports` | reports.view | Reports the user may run |
| GET | `/reports/{key}?from=&to=&group=&days=&format=` | reports.view (+ view_profit for profit reports) | JSON, or a CSV / XLSX / PDF download |

## 6. User interface

| Page | Path |
| ---- | ---- |
| Purchase orders | `/purchasing` |
| New / edit order | `/purchasing/orders/new`, `/purchasing/orders/edit?id=` |
| Order, receive deliveries | `/purchasing/orders/view?id=` |
| Suppliers | `/purchasing/suppliers` |
| Purchase history, delivery | `/purchasing/deliveries`, `/purchasing/deliveries/view?id=` |
| Cost history | `/purchasing/costs?sku_id=` |
| Cash in/out | POS header → "Cash in/out" |
| Cashier shifts | `/shifts` |
| Reports | `/reports?report=` |
