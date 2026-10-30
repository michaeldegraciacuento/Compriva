<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 7 — Suppliers, purchase orders and receiving (goods receipts).
 * Receiving is separate from ordering: one PO can be received in several
 * deliveries, and goods can be received without a PO.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suppliers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->string('name');
            $table->string('contact_person')->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email')->nullable();
            $table->string('address')->nullable();
            $table->string('tin', 20)->nullable();
            $table->unsignedSmallInteger('payment_terms_days')->default(0);
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->datetimes();
            $table->softDeletesDatetime();

            $table->index('name');
        });

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('supplier_id')->constrained()->restrictOnDelete();
            $table->string('po_number', 30)->unique();
            // draft | ordered | partially_received | received | cancelled
            $table->string('status', 20)->default('draft');
            $table->date('order_date');
            $table->date('expected_date')->nullable();
            $table->decimal('subtotal', 15, 4)->default(0);
            $table->decimal('discount_total', 15, 4)->default(0);
            $table->decimal('tax_total', 15, 4)->default(0);
            $table->decimal('total', 15, 4)->default(0);
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('ordered_at')->nullable();
            $table->dateTime('cancelled_at')->nullable();
            $table->datetimes();

            $table->index(['store_id', 'status']);
            $table->index(['supplier_id', 'order_date']);
        });

        Integrity::check('purchase_orders', 'purchase_orders_status_check',
            "status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')");
        Integrity::check('purchase_orders', 'purchase_orders_amounts_check',
            'subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND total >= 0');

        Schema::create('purchase_order_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('purchase_order_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('unit_id')->constrained()->restrictOnDelete();
            $table->decimal('conversion_factor', 15, 6)->default(1);   // snapshot: base units per ordered unit
            $table->decimal('quantity_ordered', 15, 4);
            $table->decimal('quantity_received', 15, 4)->default(0);   // in ordered units
            $table->decimal('unit_cost', 15, 4);
            $table->decimal('discount_amount', 15, 4)->default(0);
            $table->decimal('tax_rate', 7, 4)->default(0);
            $table->decimal('tax_amount', 15, 4)->default(0);
            $table->decimal('line_total', 15, 4);
            $table->datetimes();

            $table->unique(['purchase_order_id', 'product_sku_id', 'unit_id'], 'purchase_order_items_line_unique');
        });

        Integrity::check('purchase_order_items', 'purchase_order_items_quantity_check',
            'quantity_ordered > 0 AND quantity_received >= 0 AND conversion_factor > 0');
        Integrity::check('purchase_order_items', 'purchase_order_items_amounts_check',
            'unit_cost >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND line_total >= 0 AND tax_rate >= 0 AND tax_rate <= 100');

        Schema::create('goods_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('purchase_order_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('receipt_number', 30)->unique();
            $table->string('supplier_reference', 50)->nullable();   // supplier's invoice / DR number
            $table->string('status', 20)->default('draft');         // draft | posted (posted = stock moved)
            $table->decimal('total_cost', 15, 4)->default(0);
            $table->text('notes')->nullable();
            $table->dateTime('received_at');
            $table->foreignUuid('received_by')->constrained('users')->restrictOnDelete();
            $table->dateTime('posted_at')->nullable();
            $table->datetimes();

            $table->index(['store_id', 'received_at']);
        });

        Integrity::check('goods_receipts', 'goods_receipts_status_check', "status IN ('draft', 'posted')");

        Schema::create('goods_receipt_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('goods_receipt_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('purchase_order_item_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('unit_id')->constrained()->restrictOnDelete();
            $table->decimal('conversion_factor', 15, 6)->default(1);
            $table->decimal('quantity', 15, 4);                       // in received unit
            $table->decimal('base_quantity', 15, 4);                  // quantity × factor
            $table->decimal('unit_cost', 15, 4);                      // per received unit
            $table->decimal('line_total', 15, 4);
            $table->string('batch_number', 50)->nullable();
            $table->date('expiry_date')->nullable();
            $table->datetimes();
        });

        Integrity::check('goods_receipt_items', 'goods_receipt_items_quantity_check',
            'quantity > 0 AND base_quantity > 0 AND conversion_factor > 0 AND unit_cost >= 0 AND line_total >= 0');

        // A posted receipt has moved stock; corrections go through stock adjustments.
        Integrity::lockWhenPosted('goods_receipts', 'goods_receipt_items', 'goods_receipt_id');
    }

    public function down(): void
    {
        Schema::dropIfExists('goods_receipt_items');
        Schema::dropIfExists('goods_receipts');
        Schema::dropIfExists('purchase_order_items');
        Schema::dropIfExists('purchase_orders');
        Schema::dropIfExists('suppliers');
    }
};
