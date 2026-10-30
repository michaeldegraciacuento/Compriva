<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 17 — System settings and audit logs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->nullable()->constrained()->restrictOnDelete(); // NULL = global
            $table->string('group', 50);                        // receipt, tax, pos, sync, ...
            $table->string('key', 100);
            $table->json('value');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->restrictOnDelete();
            // NULL store_id would defeat a unique index (NULLs never collide), so the
            // uniqueness scope uses a non-null stored column instead.
            $table->string('scope', 36)->storedAs("COALESCE(store_id, 'global')");
            $table->datetimes();

            $table->unique(['scope', 'group', 'key']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('event', 100);                       // sale.voided, product.price_changed, user.role_changed
            $table->nullableUuidMorphs('auditable');
            $table->json('old_values')->nullable();
            $table->json('new_values')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent')->nullable();
            $table->string('request_id', 64)->nullable();
            $table->dateTime('created_at');

            $table->index(['event', 'created_at']);
            $table->index(['user_id', 'created_at']);
            $table->index('created_at');
        });

        Integrity::preventUpdates('audit_logs', 'Audit logs are append-only');
        Integrity::preventDeletes('audit_logs', 'Audit logs are append-only');
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('settings');
    }
};
