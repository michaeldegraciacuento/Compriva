<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 6 — Configurable tax and discounts.
 * Rates are percentages: 12.0000 = 12% VAT.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tax_rates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 20)->unique();               // VAT12, VAT_EXEMPT, ZERO_RATED
            $table->string('name', 100);
            $table->string('type', 20);                         // vat | vat_exempt | zero_rated | non_vat
            $table->decimal('rate', 7, 4);
            $table->boolean('is_inclusive')->default(true);    // shelf prices include VAT
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->datetimes();
        });

        Integrity::check('tax_rates', 'tax_rates_rate_check', 'rate >= 0 AND rate <= 100');
        Integrity::check('tax_rates', 'tax_rates_type_check', "type IN ('vat', 'vat_exempt', 'zero_rated', 'non_vat')");

        Schema::create('discounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->nullable()->unique();
            $table->string('name', 100);
            // promotional | senior_citizen | pwd | employee | manual
            $table->string('kind', 20)->default('promotional');
            $table->string('type', 20);                         // percentage | fixed_amount
            $table->decimal('value', 15, 4);
            $table->string('scope', 10)->default('sale');       // sale | item
            $table->decimal('min_purchase_amount', 15, 4)->nullable();
            $table->decimal('max_discount_amount', 15, 4)->nullable();
            // SC / PWD: discounted sales are VAT-exempt and need the customer's ID number.
            $table->boolean('is_vat_exempt')->default(false);
            $table->boolean('requires_customer_id')->default(false);
            $table->boolean('requires_approval')->default(false);
            $table->dateTime('starts_at')->nullable();
            $table->dateTime('ends_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->datetimes();
            $table->softDeletesDatetime();

            $table->index(['is_active', 'starts_at', 'ends_at']);
        });

        Integrity::check('discounts', 'discounts_value_check',
            "value >= 0 AND (type <> 'percentage' OR value <= 100)");
        Integrity::check('discounts', 'discounts_type_check', "type IN ('percentage', 'fixed_amount')");
        Integrity::check('discounts', 'discounts_scope_check', "scope IN ('sale', 'item')");
        Integrity::check('discounts', 'discounts_period_check', 'ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at');
    }

    public function down(): void
    {
        Schema::dropIfExists('discounts');
        Schema::dropIfExists('tax_rates');
    }
};
