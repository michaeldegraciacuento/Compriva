<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 13 (part) — Payment methods: cash, GCash, Maya, cards, bank transfer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_methods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();               // cash, gcash, maya, card
            $table->string('name', 50);
            $table->string('type', 20);                         // cash | e_wallet | card | bank_transfer | other
            $table->boolean('requires_reference')->default(false); // e-wallet / card approval number
            $table->boolean('opens_cash_drawer')->default(false);
            $table->boolean('allows_change')->default(false);    // only cash returns change
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->datetimes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_methods');
    }
};
