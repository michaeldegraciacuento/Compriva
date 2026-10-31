<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 8 — desktop terminals and offline synchronization (docs/README.md).
 *
 * sync_conflicts: what the server found when it applied an operation that
 *   was valid but did not match its own view: a sale beyond the terminal's
 *   allocation or the stock on hand, a price that changed meanwhile, a shift
 *   that collided with another. The operation is still applied (offline sales
 *   are facts); the conflict waits for a manager to review it.
 *
 * Terminals may not sell beyond their stock allocation: the setting
 * pos.allow_over_allocation becomes false.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_conflicts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $table->uuid('operation_id')->nullable();           // sync_operations.id
            // stock_shortage | over_allocation | price_changed | shift_replaced | expected_cash
            $table->string('type', 30);
            $table->string('entity', 50)->nullable();           // morph alias
            $table->uuid('entity_id')->nullable();
            $table->string('message');
            $table->json('details')->nullable();
            $table->dateTime('detected_at');
            $table->dateTime('resolved_at')->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('resolution_note')->nullable();

            $table->index(['resolved_at', 'detected_at']);
            $table->index(['device_id', 'detected_at']);
        });

        Integrity::preventDeletes('sync_conflicts', 'Sync conflicts are kept for review');

        DB::table('settings')->whereNull('store_id')->where('group', 'pos')->where('key', 'allow_over_allocation')
            ->update(['value' => json_encode(false)]);
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_conflicts');
        DB::table('settings')->whereNull('store_id')->where('group', 'pos')->where('key', 'allow_over_allocation')
            ->update(['value' => json_encode(true)]);
    }
};
