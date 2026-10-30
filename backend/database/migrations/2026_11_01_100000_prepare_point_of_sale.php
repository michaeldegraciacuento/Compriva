<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 6 — point of sale.
 *
 * The store accepts Cash, GCash and Maya only. GCash and Maya are paid by
 * scanning the store's QR code (uploaded per method and shown on the POS), and
 * the cashier records the reference number from the customer's confirmation.
 * Card and bank transfer stay in the table for history but are switched off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->string('qr_image_path')->nullable()->after('allows_change');
            $table->string('account_name', 100)->nullable()->after('qr_image_path'); // shown under the QR
            $table->string('account_number', 50)->nullable()->after('account_name');
        });

        DB::table('payment_methods')->whereNotIn('code', ['cash', 'gcash', 'maya'])->update(['is_active' => false]);
    }

    public function down(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->dropColumn(['qr_image_path', 'account_name', 'account_number']);
        });
    }
};
