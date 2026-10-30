import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { LocalDatabase, SqlStatement } from "@/platform/types";

const MIGRATIONS_DIR = join(__dirname, "../../../../src-tauri/migrations");

/**
 * The terminal's local database for tests: Node's built-in SQLite with the
 * real migrations from src-tauri/migrations, behind the same LocalDatabase
 * interface the desktop app uses ($1 placeholders, all-or-nothing transactions).
 */
export function createTestDatabase(): LocalDatabase & { raw: DatabaseSync; failNextTransaction(): void } {
  const raw = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  // $1 → ?1: SQLite numbered parameters, bound positionally.
  const prepare = (sql: string) => raw.prepare(sql.replace(/\$(\d+)/g, "?$1"));
  const values = (params: unknown[] = []) => params.map((p) => (typeof p === "boolean" ? Number(p) : p)) as (string | number | null)[];
  let failNext = false;

  return {
    raw,
    async select<T>(sql: string, params?: unknown[]) {
      return prepare(sql).all(...values(params)).map((row) => ({ ...row })) as T[];
    },
    async execute(sql: string, params?: unknown[]) {
      const result = prepare(sql).run(...values(params));
      return { rowsAffected: Number(result.changes) };
    },
    async transaction(statements: SqlStatement[]) {
      raw.exec("BEGIN");
      try {
        statements.forEach((s, i) => {
          if (failNext && i === statements.length - 1) {
            failNext = false;
            throw new Error("simulated power cut before commit");
          }
          prepare(s.sql).run(...values(s.params));
        });
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    /** The next transaction fails at its last statement (crash before commit). */
    failNextTransaction() {
      failNext = true;
    },
  };
}
