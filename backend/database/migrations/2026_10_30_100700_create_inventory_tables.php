<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domains 8 and 10 — Inventory levels, stock batches, adjustments and the
 * append-only stock movement ledger.
 *
 * stock_movements is the source of truth for stock. inventory_levels and
 * stock_batches.remaining_quantity are projections maintained by the
 * Inventory domain in the same transaction as each movement.
 * All quantities are in the SKU's base unit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_levels', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            // May go negative: offline sales are accepted even when the cloud shows no stock.
            $table->decimal('quantity_on_hand', 15, 4)->default(0);
            // Reserved for terminals (sum of unconsumed terminal_stock_allocations).
            $table->decimal('quantity_allocated', 15, 4)->default(0);
            $table->decimal('average_cost', 15, 4)->default(0);
            $table->dateTime('last_movement_at')->nullable();
            $table->datetimes();

            $table->unique(['store_id', 'product_sku_id']);
        });

        Integrity::check('inventory_levels', 'inventory_levels_amounts_check',
            'quantity_allocated >= 0 AND average_cost >= 0');

        Schema::create('stock_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('goods_receipt_item_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('batch_number', 50);
            $table->date('expiry_date')->nullable();
            $table->decimal('unit_cost', 15, 4);
            $table->decimal('initial_quantity', 15, 4);
            $table->decimal('remaining_quantity', 15, 4);
            $table->dateTime('received_at');
            $table->datetimes();

            $table->unique(['store_id', 'product_sku_id', 'batch_number']);
            // FEFO picking and expiry reports.
            $table->index(['product_sku_id', 'expiry_date']);
            $table->index(['store_id', 'expiry_date']);
        });

        Integrity::check('stock_batches', 'stock_batches_quantity_check',
            'initial_quantity > 0 AND remaining_quantity >= 0 AND remaining_quantity <= initial_quantity AND unit_cost >= 0');

        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('adjustment_number', 30)->unique();
            // count_correction | damage | expiry | theft | opening_balance | other
            $table->string('reason', 30);
            $table->string('status', 20)->default('draft');         // draft | posted
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('posted_at')->nullable();
            $table->datetimes();

            $table->index(['store_id', 'status']);
        });

        Integrity::check('stock_adjustments', 'stock_adjustments_status_check', "status IN ('draft', 'posted')");

        Schema::create('stock_adjustment_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('stock_adjustment_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('stock_batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('system_quantity', 15, 4);              // on hand when counted
            $table->decimal('counted_quantity', 15, 4)->nullable(); // NULL for non-count adjustments
            $table->decimal('quantity_change', 15, 4);              // signed, base units
            $table->decimal('unit_cost', 15, 4);
            $table->string('notes')->nullable();
            $table->datetimes();
        });

        Integrity::check('stock_adjustment_items', 'stock_adjustment_items_change_check', 'quantity_change <> 0 AND unit_cost >= 0');

        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('stock_batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained()->restrictOnDelete();
            // purchase_receipt | sale | sale_void | sale_return | adjustment | opening_balance
            $table->string('type', 30);
            $table->decimal('quantity', 15, 4);                     // signed: + in, − out (base units)
            $table->decimal('unit_cost', 15, 4);                    // cost basis for valuation / COGS
            // Source document: sale, sale_return, goods_receipt, stock_adjustment (morph map aliases).
            $table->nullableUuidMorphs('reference');
            $table->dateTime('occurred_at');                        // business time (terminal clock for offline sales)
            $table->foreignUuid('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('created_at');                         // no updated_at: rows never change

            $table->index(['store_id', 'product_sku_id', 'occurred_at'], 'stock_movements_ledger_index');
            $table->index(['type', 'occurred_at']);
        });

        Integrity::check('stock_movements', 'stock_movements_quantity_check', 'quantity <> 0 AND unit_cost >= 0');
        Integrity::check('stock_movements', 'stock_movements_type_check',
            "type IN ('purchase_receipt', 'sale', 'sale_void', 'sale_return', 'adjustment', 'opening_balance')");
        Integrity::preventUpdates('stock_movements', 'Stock movements are append-only; post a correcting movement');
        Integrity::preventDeletes('stock_movements', 'Stock movements are append-only; post a correcting movement');

        Integrity::lockWhenPosted('stock_adjustments', 'stock_adjustment_items', 'stock_adjustment_id');
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('stock_adjustment_items');
        Schema::dropIfExists('stock_adjustments');
        Schema::dropIfExists('stock_batches');
        Schema::dropIfExists('inventory_levels');
    }
};
