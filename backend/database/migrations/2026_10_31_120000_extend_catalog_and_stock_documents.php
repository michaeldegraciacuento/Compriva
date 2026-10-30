<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 5 — product images and typed stock documents.
 *
 * stock_adjustments becomes the "stock document" of every manual inventory
 * change: stock_in, stock_out and adjustment (physical count). Lines record the
 * unit the user entered, its conversion factor and, for stock-in, the batch.
 * Two movement types are added: stock_in and stock_out.
 */
return new class extends Migration
{
    private const MOVEMENT_TYPES_BEFORE = "'purchase_receipt', 'sale', 'sale_void', 'sale_return', 'adjustment', 'opening_balance'";

    private const MOVEMENT_TYPES_AFTER = "'purchase_receipt', 'sale', 'sale_void', 'sale_return', 'adjustment', 'opening_balance', 'stock_in', 'stock_out'";

    public function up(): void
    {
        Schema::create('product_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Images are presentation, not records: they go with the product.
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->string('path');                        // on the local disk: products/{uuid}.{ext}
            $table->string('mime_type', 50);
            $table->unsignedInteger('size_bytes');
            $table->unsignedSmallInteger('width')->nullable();
            $table->unsignedSmallInteger('height')->nullable();
            $table->boolean('is_primary')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->datetimes();

            $table->index(['product_id', 'sort_order']);
        });

        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->string('type', 20)->default('adjustment')->after('adjustment_number'); // stock_in | stock_out | adjustment
            $table->string('reference', 50)->nullable()->after('reason');                  // delivery receipt, memo no.
            $table->index(['type', 'status']);
        });

        Integrity::check('stock_adjustments', 'stock_adjustments_type_check', "type IN ('stock_in', 'stock_out', 'adjustment')");

        Schema::table('stock_adjustment_items', function (Blueprint $table) {
            $table->foreignUuid('unit_id')->nullable()->after('stock_batch_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 15, 4)->nullable()->after('unit_id');             // as entered, in unit_id
            $table->decimal('conversion_factor', 15, 6)->default(1)->after('quantity');   // base units per entered unit
            $table->string('batch_number', 50)->nullable()->after('conversion_factor');    // stock-in: batch to create / add to
            $table->date('expiry_date')->nullable()->after('batch_number');
        });

        Integrity::check('stock_adjustment_items', 'stock_adjustment_items_unit_check',
            'conversion_factor > 0 AND (quantity IS NULL OR quantity > 0)');

        Integrity::dropCheck('stock_movements', 'stock_movements_type_check');
        Integrity::check('stock_movements', 'stock_movements_type_check', 'type IN ('.self::MOVEMENT_TYPES_AFTER.')');
    }

    public function down(): void
    {
        Integrity::dropCheck('stock_movements', 'stock_movements_type_check');
        Integrity::check('stock_movements', 'stock_movements_type_check', 'type IN ('.self::MOVEMENT_TYPES_BEFORE.')');

        Integrity::dropCheck('stock_adjustment_items', 'stock_adjustment_items_unit_check');
        Schema::table('stock_adjustment_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('unit_id');
            $table->dropColumn(['quantity', 'conversion_factor', 'batch_number', 'expiry_date']);
        });

        Integrity::dropCheck('stock_adjustments', 'stock_adjustments_type_check');
        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->dropIndex(['type', 'status']);
            $table->dropColumn(['type', 'reference']);
        });

        Schema::dropIfExists('product_images');
    }
};
