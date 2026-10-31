//! Local SQLite database of a checkout terminal.
//!
//! Migration SQL lives in `src-tauri/migrations/*.sql`, loaded byte-for-byte with
//! `include_str!`. sqlx stores a SHA-384 checksum of every applied migration and
//! refuses to start if a shipped migration's text changes, even whitespace, so:
//!
//! - never edit a migration file that has shipped; add a new version instead
//! - the test below pins each migration's checksum, so an accidental edit fails
//!   `cargo test` instead of crashing terminals at startup
//!
//! The UI opens the same database with `Database.load(LOCAL_DB_URL)` from
//! `@tauri-apps/plugin-sql`.

use tauri_plugin_sql::{Migration, MigrationKind};

/// Relative to the app config directory (%APPDATA%\com.compriva.pos on Windows).
pub const LOCAL_DB_URL: &str = "sqlite:compriva.db";

/// (version, description, SQL). Append only.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "create_local_meta",
        include_str!("../migrations/0001_create_local_meta.sql"),
    ),
    (
        2,
        "create_offline_auth_tables",
        // cashiers: snapshot from GET /api/v1/terminal/cashiers (bcrypt PIN hashes, no passwords).
        // auth_lockouts: failed offline PIN attempts per username.
        include_str!("../migrations/0002_create_offline_auth_tables.sql"),
    ),
    (
        3,
        "create_offline_pos_tables",
        // Catalog and stock allocation cache, local shifts and sales, the sync outbox and sync history.
        include_str!("../migrations/0003_create_offline_pos_tables.sql"),
    ),
    (
        4,
        "create_customer_cache",
        // Active customers for the POS customer picker; resets the cursor so a snapshot fills it.
        include_str!("../migrations/0004_create_customer_cache.sql"),
    ),
];

pub fn migrations() -> Vec<Migration> {
    MIGRATIONS
        .iter()
        .map(|&(version, description, sql)| Migration {
            version,
            description,
            sql,
            kind: MigrationKind::Up,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha384};

    /// Checksums of shipped migrations, as recorded by sqlx on terminals.
    /// Add a line for each new migration; never change an existing one.
    const SHIPPED: &[(i64, &str)] = &[
        (
            1,
            "9b288157d2a931ddcd1e81e5c1ca5077b097380403a4cba7cf373310fa2ab33daedb1d03c594e4c80cc11e40d6374274",
        ),
        (
            2,
            "f63636eab0b2713118b898a7e78755ee12516d752ada374784672720bf89deeb9d9828aff60888a36c90ec58f25842d9",
        ),
        (
            3,
            "86ab71c6144f6acf8f04e3d596342a34a39fcd224f504afdb6b6b29a5dec5f2c8a9b097da6acff015547b6df0dfbe82b",
        ),
        (
            4,
            "ed011a9a1bbef12c2bff0952d74e0b0bda53fe4fd65072c17347273233f8fc31a52f921addad7ee3d6a19eff72783f55",
        ),
    ];

    #[test]
    fn shipped_migrations_are_unchanged() {
        for &(version, expected) in SHIPPED {
            let (_, _, sql) = MIGRATIONS
                .iter()
                .find(|m| m.0 == version)
                .unwrap_or_else(|| panic!("migration {version} was removed"));
            let actual: String = Sha384::digest(sql.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!(
                actual, expected,
                "migration {version} was modified; terminals that applied it will refuse to start"
            );
        }
    }

    #[test]
    fn versions_are_sequential_and_every_migration_is_pinned() {
        let versions: Vec<i64> = MIGRATIONS.iter().map(|m| m.0).collect();
        assert_eq!(versions, (1..=MIGRATIONS.len() as i64).collect::<Vec<_>>());
        assert_eq!(
            SHIPPED.len(),
            MIGRATIONS.len(),
            "pin the checksum of every new migration"
        );
    }
}
