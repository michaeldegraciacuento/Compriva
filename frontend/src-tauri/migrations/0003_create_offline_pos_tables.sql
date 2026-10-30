CREATE TABLE catalog_items (
                      sku_id      TEXT PRIMARY KEY NOT NULL,
                      name        TEXT NOT NULL,
                      code        TEXT NOT NULL,
                      category_id TEXT,
                      search      TEXT NOT NULL,
                      data        TEXT NOT NULL
                  ) STRICT;
                  CREATE INDEX catalog_items_category ON catalog_items (category_id, name);
                  CREATE TABLE catalog_barcodes (
                      barcode TEXT PRIMARY KEY NOT NULL,
                      sku_id  TEXT NOT NULL,
                      unit_id TEXT
                  ) STRICT;
                  CREATE INDEX catalog_barcodes_sku ON catalog_barcodes (sku_id);
                  CREATE TABLE local_lists (
                      name TEXT PRIMARY KEY NOT NULL,
                      data TEXT NOT NULL
                  ) STRICT;
                  CREATE TABLE stock_allocations (
                      sku_id    TEXT PRIMARY KEY NOT NULL,
                      remaining TEXT NOT NULL,
                      synced_at TEXT NOT NULL
                  ) STRICT;
                  CREATE TABLE shifts (
                      id            TEXT PRIMARY KEY NOT NULL,
                      cashier_id    TEXT NOT NULL,
                      cashier_name  TEXT NOT NULL,
                      status        TEXT NOT NULL,
                      opening_float TEXT NOT NULL,
                      opened_at     TEXT NOT NULL,
                      closed_at     TEXT,
                      data          TEXT NOT NULL
                  ) STRICT;
                  CREATE TABLE sales (
                      id               TEXT PRIMARY KEY NOT NULL,
                      receipt_number   TEXT NOT NULL UNIQUE,
                      receipt_sequence INTEGER NOT NULL UNIQUE,
                      shift_id         TEXT NOT NULL,
                      status           TEXT NOT NULL,
                      grand_total      TEXT NOT NULL,
                      occurred_at      TEXT NOT NULL,
                      data             TEXT NOT NULL
                  ) STRICT;
                  CREATE INDEX sales_shift ON sales (shift_id, occurred_at);
                  CREATE TABLE sale_consumption (
                      sale_id       TEXT NOT NULL,
                      operation_id  TEXT NOT NULL,
                      sku_id        TEXT NOT NULL,
                      base_quantity TEXT NOT NULL
                  ) STRICT;
                  CREATE INDEX sale_consumption_operation ON sale_consumption (operation_id);
                  CREATE TABLE cash_movements (
                      id          TEXT PRIMARY KEY NOT NULL,
                      shift_id    TEXT NOT NULL,
                      type        TEXT NOT NULL,
                      amount      TEXT NOT NULL,
                      data        TEXT NOT NULL
                  ) STRICT;
                  CREATE TABLE sync_outbox (
                      operation_id    TEXT PRIMARY KEY NOT NULL,
                      local_seq       INTEGER NOT NULL UNIQUE,
                      type            TEXT NOT NULL,
                      payload         TEXT NOT NULL,
                      schema_version  INTEGER NOT NULL DEFAULT 1,
                      created_at      TEXT NOT NULL,
                      status          TEXT NOT NULL DEFAULT 'pending',
                      attempts        INTEGER NOT NULL DEFAULT 0,
                      last_error      TEXT,
                      result          TEXT,
                      synced_at       TEXT
                  ) STRICT;
                  CREATE INDEX sync_outbox_status ON sync_outbox (status, local_seq);
                  CREATE TABLE sync_log (
                      id          INTEGER PRIMARY KEY AUTOINCREMENT,
                      started_at  TEXT NOT NULL,
                      finished_at TEXT NOT NULL,
                      outcome     TEXT NOT NULL,
                      pushed      INTEGER NOT NULL DEFAULT 0,
                      rejected    INTEGER NOT NULL DEFAULT 0,
                      pulled      INTEGER NOT NULL DEFAULT 0,
                      message     TEXT
                  );
