<?php

namespace Tests\Feature\Database;

use Illuminate\Support\Facades\DB;

/** Verifies the schema follows the rules in docs/README.md. */
class SchemaConventionsTest extends DatabaseTestCase
{
    /** Tables whose keys are not UUIDs, with the documented reason. */
    private const NON_UUID_TABLES = [
        'migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs', // Laravel framework
        'sessions', 'password_reset_tokens', 'personal_access_tokens',             // Laravel framework
        'permission_role', 'role_user',                                           // composite-key pivots
        'sync_changes',                                                            // monotonic pull cursor
    ];

    /** The only foreign keys allowed to cascade: pure child rows of non-financial data. */
    private const CASCADING_FOREIGN_KEYS = [
        'permission_role.permission_id', 'permission_role.role_id',
        'role_user.role_id', 'role_user.user_id',
        'unit_conversions.product_sku_id', 'product_barcodes.product_sku_id',
        'personal_access_tokens.device_id', // tokens are credentials, not records
        'product_images.product_id',        // photos are presentation, not records
    ];

    private function database(): string
    {
        return DB::connection()->getDatabaseName();
    }

    public function test_application_tables_use_uuid_primary_keys(): void
    {
        $keys = DB::select(
            "SELECT k.TABLE_NAME AS table_name, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS length
               FROM information_schema.KEY_COLUMN_USAGE k
               JOIN information_schema.COLUMNS c
                 ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
              WHERE k.TABLE_SCHEMA = ? AND k.CONSTRAINT_NAME = 'PRIMARY'",
            [$this->database()],
        );

        $checked = 0;
        foreach ($keys as $key) {
            if (in_array($key->table_name, self::NON_UUID_TABLES, true)) {
                continue;
            }
            $this->assertSame(['char', 36], [$key->type, (int) $key->length], "{$key->table_name} must use a UUID key");
            $checked++;
        }

        $this->assertGreaterThanOrEqual(40, $checked);
    }

    public function test_decimal_columns_use_the_agreed_precisions(): void
    {
        $columns = DB::select(
            "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
                    NUMERIC_PRECISION AS p, NUMERIC_SCALE AS s
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND DATA_TYPE = 'decimal'",
            [$this->database()],
        );

        $this->assertNotEmpty($columns);

        foreach ($columns as $c) {
            $expected = match (true) {
                in_array($c->column_name, ['rate', 'tax_rate'], true) => [7, 4],              // tax rates
                in_array($c->column_name, ['factor', 'conversion_factor'], true) => [15, 6],  // unit conversions
                default => [15, 4],                                                           // money and quantities
            };
            $this->assertSame($expected, [(int) $c->p, (int) $c->s], "{$c->table_name}.{$c->column_name}");
        }
    }

    public function test_only_documented_foreign_keys_cascade(): void
    {
        $cascading = collect(DB::select(
            "SELECT r.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name, r.DELETE_RULE AS rule
               FROM information_schema.REFERENTIAL_CONSTRAINTS r
               JOIN information_schema.KEY_COLUMN_USAGE k
                 ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME AND k.TABLE_NAME = r.TABLE_NAME
              WHERE r.CONSTRAINT_SCHEMA = ? AND r.DELETE_RULE <> 'RESTRICT'",
            [$this->database()],
        ))->map(fn ($fk) => "{$fk->table_name}.{$fk->column_name}")->sort()->values()->all();

        $this->assertSame(collect(self::CASCADING_FOREIGN_KEYS)->sort()->values()->all(), $cascading);
    }

    public function test_append_only_and_financial_tables_have_protective_triggers(): void
    {
        $triggers = collect(DB::select(
            'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
            [$this->database()],
        ))->pluck('name');

        foreach (['stock_movements', 'sale_items', 'sale_discounts', 'payments', 'cash_movements', 'sale_returns',
            'sale_return_items', 'refunds', 'stock_allocation_events', 'audit_logs', 'sale_customer_links'] as $table) {
            $this->assertContains("{$table}_prevent_update", $triggers);
            $this->assertContains("{$table}_prevent_delete", $triggers);
        }

        foreach (['sales_prevent_delete', 'sales_freeze_financials', 'sales_void_is_final',
            'cashier_shifts_prevent_delete', 'cashier_shifts_lock_closed',
            'goods_receipts_lock_posted_update', 'stock_adjustments_lock_posted_update'] as $trigger) {
            $this->assertContains($trigger, $triggers);
        }
    }
}
