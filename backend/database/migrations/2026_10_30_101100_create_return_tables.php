<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 15 — Returns and refunds.
 * A return references the original sale and the exact sale items returned;
 * refunds record how money went back to the customer (split refunds allowed).
 * All three tables are append-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('cashier_shift_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('return_number', 30)->unique();
            $table->string('reason');
            $table->decimal('subtotal', 15, 4);                 // Σ item refund amounts
            $table->decimal('vat_amount', 15, 4)->default(0);
            $table->decimal('total_refund', 15, 4);
            $table->foreignUuid('processed_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('occurred_at');
            $table->date('business_date');
            $table->dateTime('synced_at')->nullable();
            $table->uuid('operation_id')->nullable()->unique();
            $table->datetimes();

            $table->index(['store_id', 'business_date']);
            $table->index('sale_id');
        });

        Integrity::check('sale_returns', 'sale_returns_amounts_check',
            'subtotal >= 0 AND vat_amount >= 0 AND total_refund >= 0');
        Integrity::preventUpdates('sale_returns', 'Returns cannot be modified');
        Integrity::preventDeletes('sale_returns', 'Returns cannot be deleted');

        Schema::create('sale_return_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sale_return_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_item_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('stock_batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 15, 4);                 // in the sold unit
            $table->decimal('base_quantity', 15, 4);
            $table->decimal('unit_price', 15, 4);               // snapshot of the price charged
            $table->decimal('tax_amount', 15, 4)->default(0);
            $table->decimal('refund_amount', 15, 4);
            $table->boolean('restock')->default(true);          // false → no stock movement (damaged)
            $table->string('condition', 20)->default('resellable'); // resellable | damaged | expired
            $table->dateTime('created_at');

            $table->index('sale_return_id');
            $table->index('sale_item_id');
        });

        Integrity::check('sale_return_items', 'sale_return_items_amounts_check',
            'quantity > 0 AND base_quantity > 0 AND unit_price >= 0 AND tax_amount >= 0 AND refund_amount >= 0');
        Integrity::preventUpdates('sale_return_items', 'Return items cannot be modified');
        Integrity::preventDeletes('sale_return_items', 'Return items cannot be deleted');

        Schema::create('refunds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sale_return_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('payment_method_id')->constrained()->restrictOnDelete();
            $table->string('method_code', 30);
            $table->decimal('amount', 15, 4);
            $table->string('reference_number', 100)->nullable();
            $table->dateTime('refunded_at');
            $table->dateTime('created_at');

            $table->index('sale_return_id');
        });

        Integrity::check('refunds', 'refunds_amount_check', 'amount > 0');
        Integrity::preventUpdates('refunds', 'Refunds cannot be modified');
        Integrity::preventDeletes('refunds', 'Refunds cannot be deleted');
    }

    public function down(): void
    {
        Schema::dropIfExists('refunds');
        Schema::dropIfExists('sale_return_items');
        Schema::dropIfExists('sale_returns');
    }
};
