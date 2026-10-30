# Products and inventory

How the catalog and the stock ledger work, which endpoints exist, and the rules they enforce.
Checkout and purchasing are not part of this module yet; they will post through the same ledger.

## 1. Catalog model

```
Product (name, category, brand, tax rate, tracking flags, images)
 └─ SKU (code, variant, base unit, cost, reorder level/quantity, active)
     ├─ Unit conversions  1 box = 24 pc   (the base unit is always factor 1)
     ├─ Barcodes          EAN-13/EAN-8/UPC-A (check digit verified), Code 128, store codes
     └─ Prices            per unit and tier (retail, wholesale, member), effective-dated
```

| Concept | Rule |
| ------- | ---- |
| Base unit | Stock is always stored in the SKU's base unit. It cannot change once the SKU has stock movements (409). |
| Units | Seeded: piece, kilogram, gram, liter, milliliter, pack, box, bottle, tray, dozen, plus case, sack and meter. `allows_decimal` decides whether fractions are accepted (1.25 kg yes, 1.5 pc no). |
| Conversions | Factor = base units per unit, up to 6 decimals. A unit that a price or barcode uses cannot be removed (409). |
| SKU codes | Optional. When omitted the server issues the next `SKU-00001`-style code, compared numerically so shorter imported codes do not collide. |
| Barcodes | Globally unique. A barcode may scan as a pack unit, e.g. the barcode on a box of 24. The first barcode is primary. |
| Prices | Never edited in place. Setting a price closes the current one and opens a new row (`effective_from`, `effective_to`). A scheduled price later than an existing future price is rejected (409). `GET /skus/{id}/prices` returns the history. Requires `products.manage_prices`. |
| Activation | Products and SKUs are deactivated, never deleted, so history stays intact. Inactive items drop out of the stock list (unless `include_inactive=1`) and the SKU picker shows them as inactive. |
| Images | JPEG/PNG/WebP, max 2 MB, 64–6000 px, up to 8 per product, stored on the private `local` disk and streamed by `GET /media/product-images/{id}` (public, unguessable UUIDv7 URL). The first upload becomes primary. |
| Categories | A tree (`parent_id`). Cycles are refused. A category with products or children cannot be deleted (409); deactivate it instead. |

## 2. Stock ledger

`App\Domain\Inventory\Services\StockLedger` is the **only** code that changes stock. It writes
`inventory_levels.quantity_on_hand` / `average_cost` and `stock_batches.initial_quantity` /
`remaining_quantity`. The `GuardedByStockLedger` model trait throws if anything else changes those
columns, so inventory can never be updated silently.

Every change follows the same path:

1. A **stock document** (`stock_adjustments`, type `stock_in`, `stock_out` or `adjustment`) with lines
   is validated by `CreateStockDocument` and saved, numbered `SI-000001`, `SO-000001` or `ADJ-000001`.
2. **Posting** runs in one database transaction. It locks the document, levels and batches
   (`SELECT … FOR UPDATE`), writes one `stock_movements` row per batch touched, updates the
   level and batches, marks the document `posted` (it is then locked by triggers) and writes an
   audit entry.
3. If any line fails, for example not enough stock, the whole document rolls back. Nothing is
   half-posted.

`stock_movements` is append-only (database triggers block UPDATE and DELETE). The sum of a SKU's
movements always equals its `quantity_on_hand`; a test checks this reconciliation.

### Document types

| Type | Lines carry | Effect |
| ---- | ----------- | ------ |
| Stock in | SKU, unit, quantity, unit cost per entered unit, batch number, expiry date | Creates or tops up a batch (same SKU + batch number + expiry). Weighted average cost: `(onHand × avg + qty × cost) ÷ (onHand + qty)`. Updates the SKU's last cost. Movement type `stock_in`, or `opening_balance` for that reason. |
| Stock out | SKU, unit, quantity, optional batch | Requires `quantity ≤ on hand − allocated`, otherwise `INSUFFICIENT_STOCK`. Takes stock from the chosen batch, or by FEFO when the SKU has batches. Movement type `stock_out`. |
| Count | SKU, counted quantity in base units, batch (required for batch-tracked products) | Posts the difference between counted and system quantity, computed at posting time. Lines with no difference are dropped. Movement type `adjustment`. |

The quantity is converted to base units on the server: `quantity × factor`, with bcmath at
4 decimals. The cost per base unit is `entered cost ÷ factor`.

### Reasons

| Type | Reasons |
| ---- | ------- |
| Stock in | received, transfer_in, found, opening_balance, other |
| Stock out | damage, expiry, theft, internal_use, return_to_supplier, other |
| Count | count_correction, opening_balance, other |

### FEFO (first expired, first out)

`FefoPicker` orders a SKU's batches that still have stock: batches with an expiry date first, then
the earliest expiry, then the oldest receipt. It takes from each batch in turn until the quantity
is covered. Expired batches are not skipped, so a stock-out with reason `expiry` removes them first.
The batches page and the API list batches in the same order.

### Tracking flags (per product)

| Flag | Effect |
| ---- | ------ |
| `track_inventory` | Off for services and made-to-order items: no levels, excluded from the SKU picker. |
| `track_batches` | Stock-in requires a batch number; counts require choosing the batch. |
| `track_expiry` | Stock-in requires an expiry date. |

Stock-in creates a batch when the product tracks batches, or when a batch number or expiry date
is entered anyway; a batch without a number is named after the document (`SI-000001`). Other
products keep their stock on the inventory level only, and FEFO does not apply to them.

### Approval

| Permission | Can |
| ---------- | --- |
| `inventory.view` | See stock, documents, movements and batches |
| `inventory.adjust` | Create stock-in, stock-out and count documents. Without `inventory.approve` they are saved as **drafts** and do not change stock. |
| `inventory.approve` | Documents they create post immediately; can approve (post) or reject drafts. |

The author of a draft may discard it. A posted document cannot be rejected (409).

### Alerts

- **Low stock:** `0 < quantity_on_hand ≤ reorder_level` (only when `reorder_level > 0`).
- **Out of stock:** `quantity_on_hand ≤ 0`.
- **Expiring:** within the `inventory.expiry_warning_days` setting (default 30). Days left are
  counted in Asia/Manila calendar days.

These feed the inventory overview, the batches page, the dashboard panels and the notification bell.

## 3. API

All endpoints are under `/api/v1` and use the envelope in [api-conventions.md](api-conventions.md).

### Catalog

| Method | Path | Permission | Notes |
| ------ | ---- | ---------- | ----- |
| GET | `/categories`, `/brands`, `/units`, `/tax-rates` | products.view | Reference lists |
| POST, PATCH | `/categories[/{id}]`, `/brands[/{id}]`, `/units[/{id}]` | products.manage | |
| DELETE | `/categories/{id}`, `/brands/{id}` | products.manage | 409 when in use |
| GET | `/products?q=&category_id=&brand_id=&status=&per_page=` | products.view | `q` matches name, SKU code or an exact barcode |
| POST | `/products` | products.manage | Product plus `skus[]` (at least one), each with `base_unit_id`, `price` and an optional `barcode` |
| GET, PATCH | `/products/{id}` | view / manage | PATCH changes product fields only |
| POST | `/products/{id}/activate`, `/deactivate` | products.manage | |
| GET | `/skus/search?q=` | products.view | SKU picker: stock-tracked SKUs with units, stock and `tracks` flags; max 20 |
| POST | `/products/{id}/skus` | products.manage | |
| PATCH | `/skus/{id}` | products.manage | |
| POST | `/skus/{id}/activate`, `/deactivate` | products.manage | |
| POST, DELETE | `/skus/{id}/barcodes`, `/barcodes/{id}` | products.manage | |
| POST, PATCH, DELETE | `/skus/{id}/conversions`, `/conversions/{id}` | products.manage | |
| GET | `/skus/{id}/prices` | products.view | Full history |
| POST | `/skus/{id}/prices` | products.manage_prices | `unit_id`, `tier`, `price`, optional `effective_from` |
| POST | `/products/{id}/images` | products.manage | multipart `image` |
| POST, DELETE | `/product-images/{id}/primary`, `/product-images/{id}` | products.manage | |
| GET | `/media/product-images/{id}` | public | Image bytes |

### Inventory

| Method | Path | Permission | Notes |
| ------ | ---- | ---------- | ----- |
| GET | `/inventory/stock?q=&category_id=&status=low\|out\|ok&include_inactive=` | inventory.view | Paginated levels plus a `summary` (SKUs, low, out, stock value) |
| GET | `/inventory/documents?type=&status=&q=` | inventory.view | |
| GET | `/inventory/documents/{id}` | inventory.view | With lines |
| POST | `/inventory/stock-in`, `/inventory/stock-out`, `/inventory/adjustments` | inventory.adjust | `reason`, `reference`, `notes`, `lines[]`. Returns 201 with the document (posted or draft) |
| POST | `/inventory/documents/{id}/approve` | inventory.approve | Posts a draft |
| DELETE | `/inventory/documents/{id}` | inventory.adjust (approver or author) | Rejects or discards a draft |
| GET | `/inventory/movements?sku_id=&type=&document_id=&from=&to=` | inventory.view | Newest first |
| GET | `/inventory/batches?sku_id=&status=expired\|expiring\|ok&include_empty=` | inventory.view | FEFO order; `meta.expiry_warning_days` |

### Errors

| Code | When |
| ---- | ---- |
| `VALIDATION_FAILED` | Bad input. Line errors use paths such as `lines.2.quantity` (wrong unit, fractions in a whole unit, missing batch or expiry, zero count difference) |
| `INSUFFICIENT_STOCK` | A stock-out exceeds available stock, overall or in the chosen batch |
| `CONFLICT` | In-use deletes, a locked base unit, a posted document, out-of-order scheduled prices |
| `BUSINESS_RULE_VIOLATION` | Other domain rules, for example a reason that does not fit the document type |

## 4. User interface

| Page | Path | Shows |
| ---- | ---- | ----- |
| Products | `/products` | Search (name, SKU, barcode scan), category and status filters, thumbnails, price range, stock |
| New product | `/products/new` | Product and first SKU in one form; defaults to the default tax rate and the piece unit |
| Edit product | `/products/edit?id=` | Tabs: SKUs & prices (prices with history, barcodes, units, edit, active switch), details, images |
| Categories & units | `/products/catalog` | Categories (tree), brands, units |
| Inventory | `/inventory` | Summary tiles, filters, stock per SKU with status and nearest expiry |
| Stock in / out / count | `/inventory/stock-in`, `/stock-out`, `/count` | SKU picker (scanner-friendly: Enter with one match adds it), line editor, reason, reference |
| Documents | `/inventory/documents`, `/documents/view?id=` | List; detail with approve, reject and movements |
| Stock history | `/inventory/movements` | The ledger, filterable by product, document, type and date |
| Batches & expiry | `/inventory/batches` | FEFO-ordered batches, expiring and expired filters |

Pages use query strings rather than dynamic route segments so that the desktop static export works.
Buttons are hidden by permission; the API checks every permission again.
