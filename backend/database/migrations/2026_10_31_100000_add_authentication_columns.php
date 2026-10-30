<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 3 — terminal pairing and device-bound tokens.
 *
 * devices.pairing_code_hash: SHA-256 of the one-time pairing code an admin
 *   gives to a terminal. The plain code is shown once and never stored.
 * personal_access_tokens.device_id: the terminal a cashier token was issued
 *   on. Revoking a device revokes every token bound to it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->char('pairing_code_hash', 64)->nullable()->unique()->after('install_id');
            $table->dateTime('pairing_code_expires_at')->nullable()->after('pairing_code_hash');
        });

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            // Tokens are credentials, not records: they go with the device.
            $table->foreignUuid('device_id')->nullable()->after('tokenable_id')
                ->constrained()->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropConstrainedForeignId('device_id');
        });

        Schema::table('devices', function (Blueprint $table) {
            $table->dropUnique(['pairing_code_hash']);
            $table->dropColumn(['pairing_code_hash', 'pairing_code_expires_at']);
        });
    }
};
