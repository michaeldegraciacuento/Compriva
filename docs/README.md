# Compriva documentation

| Document | Purpose |
| -------- | ------- |
| [architecture.md](architecture.md) | System architecture, boundaries, project structure, platform abstraction, key decisions |
| [database.md](database.md) | Database design: decisions, integrity rules, ERDs, seed data |
| [authentication.md](authentication.md) | Authentication and authorization: actors, flows, endpoints, offline sign-in, audit |
| [products-inventory.md](products-inventory.md) | Catalog, units, pricing, stock ledger, FEFO, approval, endpoints |
| [point-of-sale.md](point-of-sale.md) | Checkout: terminals, shifts, calculations, payments, voids, returns, receipts, endpoints |
| [purchasing-cashier-reports.md](purchasing-cashier-reports.md) | Suppliers, purchase orders, receiving, cost tracking, cash in/out, reports and exports, permissions |
| [design-system.md](design-system.md) | Design system: tokens, typography, layout, components, chart rules, dashboard |
| [api-conventions.md](api-conventions.md) | URLs, headers, response shapes, data types, pagination, idempotency |
| [error-handling.md](error-handling.md) | Error envelope, code catalog, backend/frontend/desktop rules |
| [offline-sync.md](offline-sync.md) | Offline-first strategy and synchronization design |
| [coding-standards.md](coding-standards.md) | Code style, layering, naming, testing, Git |
| [environment.md](environment.md) | Environment variables and configuration per environment |
| [phase-0-environment-setup.md](phase-0-environment-setup.md) | Development environment, verified versions |
| [phase-1-architecture.md](phase-1-architecture.md) | Architecture phase: decisions, changes, verification |
| [phase-2-database.md](phase-2-database.md) | Database phase: deliverables, changes, verification |
| [phase-3-authentication.md](phase-3-authentication.md) | Authentication phase: features, security, verification |
| [phase-4-ui-dashboard.md](phase-4-ui-dashboard.md) | UI/UX and dashboard phase: deliverables, changes, verification |
| [phase-5-products-inventory.md](phase-5-products-inventory.md) | Products and inventory phase: deliverables, changes, verification |
| [phase-6-point-of-sale.md](phase-6-point-of-sale.md) | Point of sale phase: deliverables, changes, verification |
| [phase-7-purchasing-cashier-reports.md](phase-7-purchasing-cashier-reports.md) | Purchasing, cashier and reports phase: deliverables, changes, verification |

## Phases

Development is modular and phase-based. Each phase is completed and tested before the next begins.
Add one document per phase (`phase-N-<name>.md`) recording scope, decisions and verification results.

| Phase | Name | Status |
| ----- | ---- | ------ |
| 0 | Development environment setup | Done |
| 1 | System architecture | Done |
| 2 | Database design | Done |
| 3 | Authentication and authorization | Done |
| 4 | UI/UX and dashboard | Done |
| 5 | Products and inventory | Done |
| 6 | Point of sale and sales engine | Done |
| 7 | Purchasing, cashier and reports | Done |
