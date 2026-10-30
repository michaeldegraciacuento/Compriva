<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 11 — Customers. Terminals may create customers offline (UUID keys).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->nullable()->unique();
            $table->string('name');
            $table->string('type', 20)->default('regular');    // regular | senior_citizen | pwd | business
            $table->string('phone', 30)->nullable()->index();
            $table->string('email')->nullable()->index();
            $table->string('address')->nullable();
            $table->string('tin', 20)->nullable();              // business customers (invoices)
            $table->string('id_number', 50)->nullable();        // SC / PWD ID card number
            $table->date('birth_date')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by_device_id')->nullable()->constrained('devices')->restrictOnDelete();
            $table->datetimes();
            $table->softDeletesDatetime();

            $table->index('name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
