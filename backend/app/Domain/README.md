# Domain modules

Business rules live here, one folder per bounded context. Controllers stay thin and call into
these modules. See `docs/README.md` and `docs/README.md`.

| Module | Owns | UI module(s) |
| ------ | ---- | ------------ |
| `Catalog` | Products, SKUs, barcodes, categories, units, prices | Products |
| `Inventory` | Stock levels, movements, adjustments, batches, expiry, terminal stock allocations | Inventory |
| `Purchasing` | Suppliers, purchase orders, receiving | Purchasing |
| `Customers` | Customer records and purchase history | Customers |
| `Sales` | Sales transactions, voids, returns, receipts | Point of Sale, Sales |
| `Payments` | Payment methods (cash, GCash, Maya, cards), split payments, tenders | Payments |
| `Cashiering` | Shifts, opening float, cash-in / cash-out, drawer counts | Cashier |
| `Reporting` | Read models and queries for sales, profit, stock and cashier reports | Dashboard, Reports |
| `Identity` | Users, roles, permissions, authentication | Users |
| `Settings` | Store profile, tax (VAT / non-VAT), receipt and payment settings | Settings |
| `Devices` | Terminal registration, device identity, device tokens, revocation | Devices |
| `Sync` | Offline operation ingestion, idempotency, terminal snapshots and deltas | Devices |

## Layout inside a module

Create only the folders a module needs:

```
Domain/Sales/
├── Actions/      One public use case per class: CompleteSale, VoidSale (`execute()` / `__invoke`)
├── Data/         Immutable input/output objects passed between layers
├── Enums/        SaleStatus, PaymentMethod, ...
├── Events/       Domain events: SaleCompleted, StockAdjusted
├── Exceptions/   Subclasses of App\Support\Errors\BusinessException
├── Policies/     Authorization for the module's models
├── Queries/      Read-side query objects (reports, lookups)
└── Services/     Logic shared by several actions of the module
```

Eloquent models stay in `app/Models` (Laravel convention, so factories, auth and policies
auto-discover). A model belongs to the module that owns its table, as listed above.

Rules:

- A module may call another module's **Actions** or **Queries**, never write to another module's tables directly.
- Money and quantities are `DECIMAL(15,4)` decimal strings (`decimal:4` casts, bcmath), never `float`.
- Every write that a terminal can perform offline must be idempotent on its operation ID (see `docs/README.md`).
