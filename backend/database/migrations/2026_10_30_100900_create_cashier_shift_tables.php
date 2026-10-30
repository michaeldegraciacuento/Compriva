<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 14 — Cashier shifts and cash drawer movements.
 * Shifts are opened and closed on terminals (possibly offline): UUIDs come
 * from the terminal and operation IDs make sync idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cashier_shifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('cashier_id')->constrained('users')->restrictOnDelete();
            $table->string('status', 10)->default('open');      // open | closed
            $table->decimal('opening_float', 15, 4)->default(0);
            $table->decimal('expected_cash', 15, 4)->nullable(); // computed at close
            $table->decimal('counted_cash', 15, 4)->nullable();
            $table->decimal('cash_variance', 15, 4)->nullable(); // counted − expected
            $table->dateTime('opened_at');
            $table->dateTime('closed_at')->nullable();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('notes')->nullable();
            $table->uuid('open_operation_id')->nullable()->unique();
            $table->uuid('close_operation_id')->nullable()->unique();
            // Equals device_id while the shift is open, NULL once closed: a unique index on it
            // allows at most one open shift per terminal (MySQL has no partial indexes).
            $table->uuid('open_device_key')->nullable()
                ->storedAs("CASE WHEN status = 'open' THEN device_id END")
                ->unique();
            $table->datetimes();

            $table->index(['cashier_id', 'opened_at']);
            $table->index(['store_id', 'opened_at']);
        });

        Integrity::check('cashier_shifts', 'cashier_shifts_status_check',
            "(status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL)");
        Integrity::check('cashier_shifts', 'cashier_shifts_amounts_check',
            'opening_float >= 0 AND (counted_cash IS NULL OR counted_cash >= 0)');
        Integrity::guardUpdates('cashier_shifts', 'cashier_shifts_lock_closed',
            "OLD.status = 'closed'", 'A closed shift cannot be changed');
        Integrity::preventDeletes('cashier_shifts', 'Cashier shifts are financial records and cannot be deleted');

        Schema::create('cash_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('cashier_shift_id')->constrained()->restrictOnDelete();
            $table->string('type', 20);                         // cash_in | cash_out | cash_drop
            $table->decimal('amount', 15, 4);
            $table->string('reason');
            $table->foreignUuid('performed_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('occurred_at');
            $table->uuid('operation_id')->nullable()->unique();
            $table->dateTime('created_at');

            $table->index(['cashier_shift_id', 'occurred_at']);
        });

        Integrity::check('cash_movements', 'cash_movements_amount_check', 'amount > 0');
        Integrity::check('cash_movements', 'cash_movements_type_check', "type IN ('cash_in', 'cash_out', 'cash_drop')");
        Integrity::preventUpdates('cash_movements', 'Cash movements are append-only');
        Integrity::preventDeletes('cash_movements', 'Cash movements are append-only');
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_movements');
        Schema::dropIfExists('cashier_shifts');
    }
};
