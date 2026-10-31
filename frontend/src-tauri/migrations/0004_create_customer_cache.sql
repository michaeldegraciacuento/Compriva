-- Customers the POS can pick offline: active customers from the server, in the
-- shape the customer picker needs (docs/customers-users-roles.md section 2).
CREATE TABLE customers (
    id     TEXT PRIMARY KEY NOT NULL,
    name   TEXT NOT NULL,
    search TEXT NOT NULL,
    data   TEXT NOT NULL
) STRICT;
CREATE INDEX customers_name ON customers (name);

-- Terminals set up before this table existed pull a full snapshot on their next
-- sync, which fills it (the same path as a cursor the server no longer knows).
DELETE FROM local_meta WHERE key = 'sync.cursor';
