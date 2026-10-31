<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 9 — Terminal stock allocations (docs/README.md).
 *
 * A terminal may sell offline only from the quantity allocated to it, so two
 * offline terminals can never sell the same stock. The allocation row is the
 * current balance; stock_allocation_events is its append-only ledger.
 *
 *   available on terminal = allocated − consumed − released
 *
 * consumed may exceed allocated when the store allows selling beyond the
 * allocation offline (the sale line is flagged over_allocation).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('terminal_stock_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->decimal('allocated_quantity', 15, 4)->default(0);  // cumulative, base units
            $table->decimal('consumed_quantity', 15, 4)->default(0);  // sold (from synced sales)
            $table->decimal('released_quantity', 15, 4)->default(0);  // returned to central stock
            $table->dateTime('last_event_at')->nullable();
            $table->datetimes();

            $table->unique(['device_id', 'product_sku_id']);
            $table->index(['store_id', 'product_sku_id']);
        });

        Integrity::check('terminal_stock_allocations', 'terminal_stock_allocations_quantity_check',
            'allocated_quantity >= 0 AND consumed_quantity >= 0 AND released_quantity >= 0 '.
            'AND released_quantity <= allocated_quantity');

        Schema::create('stock_allocation_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('terminal_stock_allocation_id')->constrained()->restrictOnDelete();
            $table->string('type', 20);                         // allocate | release | consume
            $table->decimal('quantity', 15, 4);                 // positive, base units
            $table->foreignUuid('sale_id')->nullable()->constrained()->restrictOnDelete();      // consume
            $table->uuid('operation_id')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('occurred_at');
            $table->dateTime('created_at');

            $table->index(['terminal_stock_allocation_id', 'occurred_at'], 'stock_allocation_events_ledger_index');
        });

        Integrity::check('stock_allocation_events', 'stock_allocation_events_check',
            "quantity > 0 AND type IN ('allocate', 'release', 'consume')");
        Integrity::preventUpdates('stock_allocation_events', 'Allocation events are append-only');
        Integrity::preventDeletes('stock_allocation_events', 'Allocation events are append-only');
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_allocation_events');
        Schema::dropIfExists('terminal_stock_allocations');
    }
};
