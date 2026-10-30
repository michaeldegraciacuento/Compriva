<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domains 4 and 5 — Products, SKUs, barcodes, unit conversions and pricing.
 *
 * product  (what it is: "Coca-Cola Regular")
 *   └─ product_sku  (what is stocked and sold: "Coca-Cola 1.5L"; inventory is per SKU, in its base unit)
 *        ├─ unit_conversions  (1 case = 12 base units)
 *        ├─ product_barcodes  (each barcode scans as a unit of the SKU)
 *        └─ product_prices    (price per unit and tier, effective-dated history)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('category_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('brand_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('tax_rate_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->boolean('track_inventory')->default(true);
            $table->boolean('track_batches')->default(false);   // lot numbers
            $table->boolean('track_expiry')->default(false);    // perishables: FEFO
            $table->boolean('is_active')->default(true);
            $table->datetimes();
            $table->softDeletesDatetime();

            $table->index('name');
            $table->index(['category_id', 'is_active']);
        });

        Schema::create('product_skus', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('base_unit_id')->constrained('units')->restrictOnDelete();
            $table->string('code', 50)->unique();               // internal SKU code
            $table->string('name');                             // full display name incl. variant
            $table->string('variant', 100)->nullable();         // "1.5L", "Chocolate"
            $table->decimal('cost_price', 15, 4)->default(0);   // latest purchase cost per base unit
            $table->decimal('reorder_level', 15, 4)->default(0);
            $table->decimal('reorder_quantity', 15, 4)->default(0);
            $table->boolean('is_active')->default(true);
            $table->datetimes();
            $table->softDeletesDatetime();

            $table->index(['product_id', 'is_active']);
            $table->index('name');
        });

        Integrity::check('product_skus', 'product_skus_amounts_check',
            'cost_price >= 0 AND reorder_level >= 0 AND reorder_quantity >= 0');

        Schema::create('unit_conversions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_sku_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('unit_id')->constrained()->restrictOnDelete();
            // How many base units one of `unit_id` contains: 1 case = 12.000000 pcs.
            $table->decimal('factor', 15, 6);
            $table->boolean('is_purchase_unit')->default(false);
            $table->boolean('is_sales_unit')->default(true);
            $table->datetimes();

            $table->unique(['product_sku_id', 'unit_id']);
        });

        Integrity::check('unit_conversions', 'unit_conversions_factor_check', 'factor > 0');

        Schema::create('product_barcodes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_sku_id')->constrained()->cascadeOnDelete();
            // Unit the barcode represents (a case barcode scans as 1 case). NULL = base unit.
            $table->foreignUuid('unit_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('barcode', 64)->unique();            // EAN-13, UPC-A, internal codes
            $table->string('type', 20)->default('ean13');      // ean13 | ean8 | upca | code128 | internal
            $table->boolean('is_primary')->default(false);
            $table->datetimes();

            $table->index('product_sku_id');
        });

        Schema::create('product_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('product_sku_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('unit_id')->constrained()->restrictOnDelete();
            $table->string('tier', 20)->default('retail');     // retail | wholesale | member
            $table->decimal('price', 15, 4);                    // tax-inclusive when the tax rate is inclusive
            $table->dateTime('effective_from');
            $table->dateTime('effective_to')->nullable();       // NULL = current
            $table->foreignUuid('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->datetimes();

            // Price lookup: SKU + unit + tier, most recent effective_from first.
            $table->index(['product_sku_id', 'unit_id', 'tier', 'effective_from'], 'product_prices_lookup_index');
        });

        Integrity::check('product_prices', 'product_prices_price_check', 'price >= 0');
        Integrity::check('product_prices', 'product_prices_period_check', 'effective_to IS NULL OR effective_to > effective_from');
    }

    public function down(): void
    {
        Schema::dropIfExists('product_prices');
        Schema::dropIfExists('product_barcodes');
        Schema::dropIfExists('unit_conversions');
        Schema::dropIfExists('product_skus');
        Schema::dropIfExists('products');
    }
};
