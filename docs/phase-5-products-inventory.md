# Phase 5: Products and inventory

Completed 2026-10-30. Reference: [products-inventory.md](products-inventory.md).

## Deliverables

| Requirement | Result |
| ----------- | ------ |
| Products, categories, brands | CRUD with search, filters and activation; category tree with cycle and in-use protection |
| SKUs, barcodes | Several SKUs per product; automatic SKU codes; EAN/UPC check digits; barcodes per pack unit |
| Images | Upload, primary, delete; served from private storage |
| Pricing | Effective-dated price history per unit and tier; separate `products.manage_prices` permission |
| Units, conversions | All ten grocery units seeded (bottle and tray added); per-SKU conversions; whole-number rules |
| Stock overview | Summary tiles, low and out-of-stock status, stock value, nearest expiry |
| Stock in, stock out, adjustments | Numbered documents; immediate posting for approvers, drafts plus approval for others |
| Movements, stock history | Append-only ledger, filterable; per product and per document |
| Batches, expiration, FEFO | Batches on every stock-in; FEFO picking; expiring and expired views |
| Low-stock alerts | Overview filter, dashboard panel and notification bell |
| No silent changes | Ledger-only writes, enforced by the `GuardedByStockLedger` trait and database triggers |
| Validation, transactions | Form requests plus domain validation; each posting is one locked transaction |
| Checkout | Not implemented (out of scope) |

## Changes

**Backend**
- Migration `2026_10_31_120000_extend_catalog_and_stock_documents`: adds `product_images`; adds
  `type` and `reference` to stock documents; adds unit, quantity, conversion factor, batch number
  and expiry to document lines; allows the `stock_in` and `stock_out` movement types.
- Domain:
  - Inventory: `StockLedger`, `FefoPicker`, `CreateStockDocument`, `ReviewStockDocument` and the
    `StockOverview` query.
  - Catalog: `SaveProduct`, `ManageBarcodes`, `ManageUnitConversions`, `SetProductPrice`,
    `ManageProductImages` and `ManageTaxonomy`.
- Supporting code: the `StockDocumentType` enum, an extended `AdjustmentReason`, the
  `INSUFFICIENT_STOCK` error code, the `BarcodeRule` validator and the `GuardedByStockLedger` trait.
- Controllers: `CatalogController`, `ProductController`, `InventoryController`, with 40 routes.
- The SKU search result now includes the product's `tracks` flags, so the stock forms know when
  a batch or expiry date is required.
- **Fixed during e2e testing:** automatic SKU codes compared codes as text. In the demo data
  `SKU-0012` sorts after `SKU-00013`, so a duplicate code was issued. Codes are now compared as
  numbers, and a regression test covers it.

**Frontend**
- Modules: `catalog` (API, types, SKU helpers, 9 components) and `inventory` (API, types, line
  rules, status helpers, 7 components).
- 12 routes under `/products` and `/inventory`. Products and Inventory are enabled in the sidebar,
  and breadcrumbs follow nested pages.
- New shared components: `DialogForm`, `ConfirmDialog`, `SelectField`, `SwitchField`,
  `NativeSelect`, `SearchInput`, `Pagination` and `LinkButton`, plus the `useApiQuery` hook and
  form schemas. Added the shadcn dialog, tabs, switch and textarea components.
- `useApiQuery` and `SearchInput` no longer call setState synchronously inside effects
  (React Compiler lint).
- `INSUFFICIENT_STOCK` was added to `API_ERROR_CODES`.

## Verification

| Check | Result |
| ----- | ------ |
| Backend tests | 143 passed (StockLedgerTest 16, ProductCatalogTest 11, plus all earlier suites). Pint passes. |
| Frontend unit tests | 72 passed (new: stock line rules, SKU helpers, nested breadcrumbs) |
| Typecheck, lint | Clean |
| Builds | Web build and desktop static export both succeed (17 routes) |
| End-to-end | 18 passed. New: create product → add box unit → change price (history) → stock in 2 boxes (+24) → refused oversell → stock out 5 → overview shows 19 → history shows both movements; catalog lists; cashier sees neither module |
| Layout | All 9 new pages checked at 1440px and 390px with no horizontal overflow. Phone tables move status under the main value. |

Note: each e2e run adds an `E2E Calamansi Juice …` product to the local database.
`php artisan migrate:fresh --seed` resets the demo data.
