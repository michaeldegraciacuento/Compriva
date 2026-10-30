# Phase 2: Database design

Completed 2026-10-30. Scope: complete schema, models, relationships, seeders, factories,
constraints and integrity tests. **No API controllers or frontend features.**

Full design: [database.md](database.md) (decisions D1–D21, integrity enforcement, ERDs).

## Deliverables

| Task | Result |
| ---- | ------ |
| 1. ERD | [database.md §3](database.md#3-entity-relationship-diagrams): overview + 5 domain diagrams (Mermaid) |
| 2. Migrations in dependency order | 15 new migrations (`2026_10_30_100000` … `101400`) + 2 starter migrations converted to UUIDs |
| 3. Eloquent models | 42 new models + `User` updated (43 in `app/Models`), 21 enums in `app/Domain/*/Enums` |
| 4. Relationships | Defined on all models; a check verified every relation maps to an existing column |
| 5. Seeders and factories | 5 seeders (4 production-safe + demo); 38 factories (37 new + `UserFactory` updated) |
| 6. Constraints and indexes | 102 foreign keys (96 restrict), 40 CHECK constraints, 35 triggers, unique and lookup indexes |
| 7. Run migrations | `migrate:fresh --seed`, full `migrate:rollback`, re-`migrate --seed`: all succeed |
| 8. Integrity tests | 44 new database tests in `tests/Feature/Database` |

## Changes to earlier phases

The Phase 2 specification replaced two Phase 1 decisions:

| Phase 1 | Phase 2 | Updated |
| ------- | ------- | ------- |
| Money as integer centavos | `DECIMAL(15,4)`, decimal strings in API/TS | `docs/architecture.md`, `api-conventions.md`, `coding-standards.md`, `phase-1-architecture.md`; frontend `Money`/`Quantity`/`Rate` types, `formatCentavos()` → `formatMoney()` (BigInt rounding, tests) |
| Integer IDs for cloud-only tables | UUIDv7 everywhere | Same docs; starter `users`, `sessions.user_id` and Sanctum `tokenable` converted to UUIDs |

Other changes:

- `users`: added `username` (sign-in), `pin_hash`, `is_active`, `last_login_at`, soft deletes; `email` now optional.
- `AppServiceProvider`: enforced morph map; `Model::unguard()` (validated input is the mass-assignment guard) and `Model::shouldBeStrict()` outside production.
- `composer.json`: `ext-bcmath` required.
- `.env` / `.env.example`: `COMPRIVA_OWNER_USERNAME`, `COMPRIVA_OWNER_PASSWORD`, `COMPRIVA_STORE_CODE`, `COMPRIVA_STORE_NAME`.
- New support classes: `App\Support\Database\Integrity` (CHECK and trigger helpers),
  `ImmutableRecordException`, `MorphMap`; model concerns `AppendOnly`, `LockedWhenPosted`;
  permission catalog `App\Domain\Identity\Permissions`.

## Verification

| Check | Result |
| ----- | ------ |
| `php artisan test` | 59 passed (369 assertions). 44 are new database tests |
| `vendor/bin/pint --test` | pass |
| Migrations | 19 run, 19 roll back, 19 re-run |
| Seeding | `db:seed` twice: no duplicates; demo ledger matches inventory levels |
| Frontend `npm test`, `typecheck`, `lint` | 21 tests pass; clean |

Database tests by area:

| File | Covers |
| ---- | ------ |
| `SchemaConventionsTest` | UUID keys on all application tables; decimal precisions; only the 6 documented cascades; required triggers exist |
| `FinancialRecordIntegrityTest` | Offline UUIDs kept; UUIDv7 generation; sales undeletable and frozen; void once; fully-paid and tender checks; append-only items, payments, cash movements, returns, refunds; snapshots survive catalog edits; restrict + soft delete; receipt sequence and operation ID uniqueness; one open shift per terminal; closed shifts frozen |
| `InventoryIntegrityTest` | Append-only ledger; corrections as new movements; posted adjustments and receipts locked (incl. new lines); batch bounds; allocation uniqueness, over-allocation, release bound; allocation ledger; conversion factor rules |
| `ReferenceIntegrityTest` | Tax rate range; price history and `effectiveAt`; barcode uniqueness; scoped cascades; device code/install ID uniqueness; devices with history undeletable; sync idempotency; settings scope uniqueness incl. global; audit append-only; morph aliases |
| `SeederTest` | Idempotent reference data; no demo data outside local; owner has all permissions, cashier cannot void; consistent demo store |

## Notes for later phases

- Multi-row rules (totals = Σ lines, returned ≤ sold, ledger = projection) belong in domain Actions
  ([database.md §2](database.md#2-integrity-enforcement)). The Sales and Inventory phases must implement them in transactions and add reconciliation reports.
- Production MySQL needs trigger privileges ([database.md §6](database.md#6-mysql-84--mariadb-compatibility-and-operations)).
- Frontend arithmetic on money needs a decimal library (choose in the POS phase); `formatMoney()` handles display only.
