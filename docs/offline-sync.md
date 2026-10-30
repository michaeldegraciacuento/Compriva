# Offline-first strategy and synchronization design

Status: **design**. Phase 1 implements the foundation it relies on: device identity, the local
SQLite database with migrations, UUIDv7 generation, idempotency headers, offline-aware `ApiError`,
and the health probe. The sync engine, outbox and allocations are built in the Sync and Devices
phases following this document.

## 1. Principles

1. **Local-first checkout.** A terminal sells from its local SQLite database in *every* mode,
   online or offline. There is one checkout code path. Connectivity only affects background sync.
2. **A sale is complete when it is committed locally.** The sale, its lines, payments, stock
   allocation usage and an outbox entry are written in **one SQLite transaction** before the
   receipt prints or success is shown.
3. **Offline sales are facts.** The goods have left the store. The server records every valid
   offline sale even if its own view has changed in the meantime (price changed, stock went
   negative), and flags the discrepancy for review instead of rejecting the sale.
4. **Idempotent everything.** Each operation has a client-generated UUIDv7 `operation_id`.
   Sending it twice has the same effect as sending it once.
5. **Terminals never sell the same stock twice.** Offline selling is limited by
   terminal-specific stock allocations.
6. **The web management app is online-only.** It never writes locally. When the API is
   unreachable it shows an offline notice and disables actions.

## 2. Connectivity model

```
           health OK                  health fails / NETWORK_ERROR
 ┌────────┐ ───────────▶ ┌────────┐ ──────────────────────────────▶ ┌─────────┐
 │ Unknown│              │ Online │                                 │ Offline │
 └────────┘ ◀─────────── └────────┘ ◀────────────────────────────── └─────────┘
            app start                      health OK again
```

- Probe: `GET /api/v1/health` every 15 s, on `online` / `offline` browser events, and after any
  `ApiError.isOffline`. A captive portal returns `INVALID_RESPONSE`, which also counts as offline.
- `server_time` from the health probe gives the **clock skew**. Skew over 5 minutes shows a
  warning, because sale timestamps come from the terminal clock.
- **Offline limit:** if the last successful sync is older than `COMPRIVA_SYNC_MAX_OFFLINE_HOURS`
  (default 72 h), the terminal stops new sales until it syncs. This bounds the risk of stale
  prices and lost data.

## 3. Local database (terminal)

`%APPDATA%\com.compriva.pos\compriva.db`, migrated by `src-tauri/src/local_db.rs`
(append-only migrations).

| Table | Purpose | Status |
| ----- | ------- | ------ |
| `local_meta` | Key/value: terminal code, last sync time, sync cursors, API URL override | **Created (migration 1)** |
| `catalog_*` | Snapshot of products, barcodes, prices, categories, tax and receipt settings | Planned |
| `cashiers` | Users allowed on this terminal + PIN hashes (no passwords) | Planned |
| `stock_allocations` | Remaining quantity this terminal may sell per product | Planned |
| `sales`, `sale_lines`, `sale_payments` | Sales created on this terminal (UUIDv7 IDs) | Planned |
| `shifts`, `cash_movements` | Cashier shifts and drawer movements | Planned |
| `sync_outbox` | Operations waiting to be pushed | Planned |

Outbox row:

| Column | Type | Notes |
| ------ | ---- | ----- |
| `operation_id` | TEXT PK | UUIDv7, also the idempotency key |
| `local_seq` | INTEGER UNIQUE | Monotonic per terminal; push order |
| `type` | TEXT | `sale.completed`, `sale.voided`, `sale.returned`, `shift.opened`, `shift.closed`, `cash.movement` |
| `payload` | TEXT (JSON) | Full self-contained operation data |
| `schema_version` | INTEGER | Payload version, for server compatibility |
| `created_at` | TEXT | Terminal clock, ISO-8601 UTC |
| `status` | TEXT | `pending` → `synced` / `rejected` |
| `attempts`, `last_error`, `synced_at` | | Retry bookkeeping |

## 4. Push: terminal → cloud

```
POST /api/v1/sync/operations          (bearer device token, X-Compriva-Device)
{ "operations": [ { "operation_id", "local_seq", "type", "schema_version", "created_at", "payload" }, … ] }

200 { "data": { "results": [
  { "operation_id": "…", "status": "applied" },
  { "operation_id": "…", "status": "duplicate" },
  { "operation_id": "…", "status": "rejected", "error": { "code": "…", "message": "…" } }
] } }
```

- Batches of at most 100, in `local_seq` order. A sale's void is never sent before the sale.
- Server, per operation: look up `(device_id, operation_id)` in a `sync_operations` table with a
  unique index.
  - Found: return `duplicate` (with the original result).
  - Otherwise: validate, apply in a DB transaction, store the result. Every operation is applied
    in its own transaction, so one bad operation does not block the batch.
- `applied` and `duplicate` both mark the outbox row `synced`.
- `rejected` is reserved for operations that can never succeed (malformed payload, revoked
  device, cashier not allowed). They are kept locally, shown on the terminal's sync screen and
  reported to managers. **Never deleted silently.**
- Network or 5xx failure: retry the whole batch with exponential backoff (5 s → 5 min, with jitter).
  Idempotency makes this safe.
- Server timestamps: `occurred_at` (terminal clock) and `received_at` (server clock) are both
  stored. Reports use `occurred_at`, converted to the Asia/Manila business day.

## 5. Pull: cloud → terminal

```
GET /api/v1/sync/changes?cursor=<opaque>&limit=500
200 { "data": { "changes": [ { "entity", "id", "op": "upsert|delete", "data" } … ], "next_cursor": "…", "has_more": false } }
410 → cursor too old: download a full snapshot, then continue from its cursor
```

- The server keeps an ordered change log for master data (products, prices, barcodes, settings,
  cashiers, allocations). Terminals apply each page in one SQLite transaction and only then save
  `next_cursor`, so a crash mid-page just replays it.
- Pull runs after each successful push, on reconnect, and periodically (every 60 s while online).
- Price changes apply to new sales immediately after pull. Carts already in progress keep the
  price they were scanned at.

## 6. Stock allocations

Without allocations, two offline terminals could each sell the last 5 units. Allocations split
available stock between terminals:

```
central available (MySQL)  =  on hand  −  Σ unsynced allocations to terminals
terminal sellable (SQLite) =  allocation  −  quantity sold locally since the allocation
```

1. The server allocates quantities per product per terminal (rule configured in Inventory, e.g.
   expected sales for N hours, capped by stock on hand) and delivers them through pull.
   Allocated quantity is reserved centrally.
2. Each local sale decreases the terminal's allocation in the same transaction as the sale.
3. When online, the terminal requests top-ups as an allocation runs low. Unused allocations are
   released back when a shift closes or on demand from the web app.
4. **Allocation exhausted while offline:** the store chooses, per product or category, either
   **block** (cannot sell beyond allocation) or **allow with flag** (the sale proceeds, the line
   is marked `over_allocation`, and inventory shows a discrepancy to resolve). Default: allow with
   flag, because refusing a customer at the lane is usually worse than a stock variance.
5. When a sale syncs, the server converts the allocation usage into a real stock movement.

## 7. Offline cashier sign-in and shifts

- The cashier list and bcrypt PIN hashes (never plain PINs or passwords) come from `GET /terminal/cashiers`; see [authentication.md §4](authentication.md#4-offline-sign-in-at-terminals).
- Shift open and close, and cash in/out, are outbox operations like sales.
- A user deactivated on the server is removed on the next pull. Until then an offline terminal
  may still accept their PIN. The offline limit bounds this window.

## 8. Receipt and transaction numbering

- Internal identity: UUIDv7 (`sales.id`), globally unique without coordination.
- Human-facing number: **terminal code + per-terminal sequence**, e.g. `T01-000123`, generated
  from a local counter in the same transaction as the sale. No cross-terminal collisions, and
  numbering stays sequential per machine.
- Philippine BIR requirements for POS (machine registration, per-machine sequential
  invoice numbers, non-resettable totals, Z-readings) must be confirmed with the store's accountant
  before the Sales phase. This design is compatible with per-machine sequences.

## 9. Failure scenarios

| Scenario | Behaviour |
| -------- | --------- |
| Internet drops mid-sale | Nothing changes for the cashier; the sale commits locally; sync resumes later |
| Power loss after commit, before print | Sale exists locally; terminal offers "reprint last receipt" on restart |
| Power loss before commit | No partial sale (single transaction); cart is lost and must be rescanned |
| Same batch sent twice (timeout after server applied it) | Second attempt returns `duplicate` for each operation |
| Price changed on server while terminal offline | Sale syncs at the offline price; server records the variance for review |
| Terminal clock wrong | Skew warning; server stores both clocks; managers can see `received_at` |
| Terminal disk lost or reinstalled | Unsynced operations are lost. Mitigations: short sync intervals, offline limit, and in a later phase an optional local backup |
| Device revoked | Server returns `DEVICE_REVOKED`; terminal stops syncing and blocks sales |
| Local schema older than the payload the server expects | `schema_version` lets the server accept older payloads; the terminal updates through the auto-updater |

## 10. Security of local data

- The device token lives in Windows Credential Manager, not in SQLite or files.
- SQLite is not encrypted in this design. It contains catalog data, PIN *hashes* and local sales.
  If disk-level risk requires it, use BitLocker on terminals or switch to SQLCipher later.
- `device.json` holds only the random install ID. It is not a secret; the token is.
