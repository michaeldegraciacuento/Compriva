//! Atomic writes to the local database.
//!
//! `@tauri-apps/plugin-sql` runs each statement on a pooled connection, so a
//! BEGIN … COMMIT spread over several calls is not reliable. Checkout must save
//! the sale, its stock usage and its outbox operation together or not at all
//! ("save sales locally before showing success"), so this command runs a list
//! of statements in one SQLite transaction on the plugin's own pool.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::sqlite::SqliteArguments;
use sqlx::query::Query;
use sqlx::Sqlite;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

/// Binds JSON values the way the SQL plugin does, except that whole numbers stay integers.
fn bind<'q>(mut query: Query<'q, Sqlite, SqliteArguments<'q>>, values: &'q [JsonValue]) -> Query<'q, Sqlite, SqliteArguments<'q>> {
    for value in values {
        query = match value {
            JsonValue::Null => query.bind(None::<String>),
            JsonValue::Bool(b) => query.bind(*b),
            JsonValue::Number(n) => match n.as_i64() {
                Some(i) => query.bind(i),
                None => query.bind(n.as_f64().unwrap_or_default()),
            },
            JsonValue::String(s) => query.bind(s.as_str()),
            other => query.bind(other.to_string()),
        };
    }
    query
}

/// Runs every statement in one transaction; on any error nothing is written.
pub async fn run<R: Runtime>(app: &AppHandle<R>, db: &str, statements: Vec<Statement>) -> Result<u64, String> {
    let instances = app.state::<DbInstances>();
    let pools = instances.0.read().await;
    let pool = match pools.get(db) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err(format!("database {db} is not open")),
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut affected = 0;
    for statement in &statements {
        let result = bind(sqlx::query(&statement.sql), &statement.params)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{e} (in: {})", statement.sql.chars().take(80).collect::<String>()))?;
        affected += result.rows_affected();
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(affected)
}
