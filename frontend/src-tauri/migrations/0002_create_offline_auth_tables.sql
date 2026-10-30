CREATE TABLE cashiers (
                      id          TEXT PRIMARY KEY NOT NULL,
                      name        TEXT NOT NULL,
                      username    TEXT NOT NULL UNIQUE,
                      pin_hash    TEXT NOT NULL,
                      roles       TEXT NOT NULL,
                      permissions TEXT NOT NULL,
                      updated_at  TEXT,
                      synced_at   TEXT NOT NULL
                  ) STRICT;
                  CREATE TABLE auth_lockouts (
                      username        TEXT PRIMARY KEY NOT NULL,
                      failed_attempts INTEGER NOT NULL DEFAULT 0,
                      locked_until    TEXT
                  ) STRICT;