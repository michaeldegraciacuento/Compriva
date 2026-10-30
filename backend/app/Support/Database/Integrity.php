<?php

namespace App\Support\Database;

use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Database-level integrity rules that Laravel's schema builder cannot express:
 * CHECK constraints and protective triggers.
 *
 * Written for MySQL 8.4 and verified on MariaDB 10.4 (local development).
 * Triggers raise SQLSTATE 45000, which surfaces as an Illuminate QueryException.
 * See docs/database.md, "Integrity enforcement".
 */
final class Integrity
{
    public const SQLSTATE = '45000';

    /**
     * Adds a named CHECK constraint. Never reference a column that is part of a
     * foreign key with CASCADE / SET NULL actions (MySQL forbids it).
     */
    public static function check(string $table, string $name, string $expression): void
    {
        self::ensureSupported();
        DB::statement("ALTER TABLE `{$table}` ADD CONSTRAINT `{$name}` CHECK ({$expression})");
    }

    /** Drops a named CHECK constraint (MySQL 8.0.19+ / MariaDB 10.2+ syntax). */
    public static function dropCheck(string $table, string $name): void
    {
        self::ensureSupported();
        DB::statement("ALTER TABLE `{$table}` DROP CONSTRAINT `{$name}`");
    }

    /** Rejects every UPDATE on the table (append-only ledgers). */
    public static function preventUpdates(string $table, string $message): void
    {
        self::trigger("{$table}_prevent_update", 'BEFORE UPDATE', $table, self::signal($message));
    }

    /** Rejects every DELETE on the table (financial and audit records). */
    public static function preventDeletes(string $table, string $message): void
    {
        self::trigger("{$table}_prevent_delete", 'BEFORE DELETE', $table, self::signal($message));
    }

    /**
     * Rejects UPDATEs for which $condition (SQL using OLD./NEW.) is true.
     */
    public static function guardUpdates(string $table, string $name, string $condition, string $message): void
    {
        self::trigger($name, 'BEFORE UPDATE', $table, "IF {$condition} THEN ".self::signal($message).' END IF;');
    }

    /**
     * Rejects DELETEs for which $condition (SQL using OLD.) is true.
     */
    public static function guardDeletes(string $table, string $name, string $condition, string $message): void
    {
        self::trigger($name, 'BEFORE DELETE', $table, "IF {$condition} THEN ".self::signal($message).' END IF;');
    }

    /**
     * Makes a document immutable once posted: rejects updates and deletes of a
     * posted header and inserts, updates and deletes of its lines.
     */
    public static function lockWhenPosted(string $headerTable, string $linesTable, string $foreignKey): void
    {
        $message = "Posted {$headerTable} cannot be changed";
        $headerPosted = fn (string $row) => "EXISTS (SELECT 1 FROM `{$headerTable}` WHERE id = {$row}.{$foreignKey} AND status = 'posted')";

        self::guardUpdates($headerTable, "{$headerTable}_lock_posted_update", "OLD.status = 'posted'", $message);
        self::guardDeletes($headerTable, "{$headerTable}_lock_posted_delete", "OLD.status = 'posted'", $message);
        self::trigger("{$linesTable}_lock_posted_insert", 'BEFORE INSERT', $linesTable,
            "IF {$headerPosted('NEW')} THEN ".self::signal($message).' END IF;');
        self::guardUpdates($linesTable, "{$linesTable}_lock_posted_update", $headerPosted('OLD'), $message);
        self::guardDeletes($linesTable, "{$linesTable}_lock_posted_delete", $headerPosted('OLD'), $message);
    }

    public static function dropTrigger(string $name): void
    {
        self::ensureSupported();
        DB::unprepared("DROP TRIGGER IF EXISTS `{$name}`");
    }

    private static function trigger(string $name, string $timing, string $table, string $body): void
    {
        self::ensureSupported();
        DB::unprepared("CREATE TRIGGER `{$name}` {$timing} ON `{$table}` FOR EACH ROW BEGIN {$body} END");
    }

    private static function signal(string $message): string
    {
        $message = str_replace("'", "''", $message);

        return "SIGNAL SQLSTATE '".self::SQLSTATE."' SET MESSAGE_TEXT = '{$message}';";
    }

    private static function ensureSupported(): void
    {
        $driver = DB::connection()->getDriverName();

        if (! in_array($driver, ['mysql', 'mariadb'], true)) {
            throw new LogicException("Compriva migrations require MySQL or MariaDB, not [{$driver}].");
        }
    }
}
