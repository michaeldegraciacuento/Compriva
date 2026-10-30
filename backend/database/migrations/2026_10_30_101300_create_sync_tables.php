<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domain 16 — Synchronization (docs/offline-sync.md).
 *
 * sync_operations: every operation pushed by a terminal, keyed by its
 *   operation_id. The primary key makes pushes idempotent.
 * sync_changes:    ordered change log of master data that terminals pull.
 *   Uses an auto-increment key on purpose: the cursor must be a strictly
 *   increasing sequence, which UUIDs cannot guarantee across app servers.
 * sync_cursors:    how far each terminal has pulled each stream.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_operations', function (Blueprint $table) {
            $table->uuid('id')->primary();                      // = operation_id from the terminal
            $table->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('local_seq');            // terminal outbox order
            $table->string('type', 50);                         // sale.completed, shift.closed, ...
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->json('payload');
            $table->string('status', 20);                       // applied | rejected
            $table->json('result')->nullable();                 // returned again for duplicates
            $table->string('error_code', 50)->nullable();
            $table->string('error_message')->nullable();
            $table->dateTime('occurred_at');                    // terminal clock
            $table->dateTime('received_at');                    // server clock
            $table->dateTime('processed_at')->nullable();

            $table->unique(['device_id', 'local_seq']);
            $table->index(['device_id', 'status']);
            $table->index(['type', 'received_at']);
        });

        Integrity::check('sync_operations', 'sync_operations_status_check', "status IN ('applied', 'rejected')");

        Schema::create('sync_changes', function (Blueprint $table) {
            $table->id();                                       // the pull cursor
            $table->foreignUuid('store_id')->nullable()->constrained()->restrictOnDelete();
            // NULL = for every terminal; set for terminal-specific data (allocations).
            $table->foreignUuid('device_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('stream', 30);                       // catalog | pricing | cashiers | settings | allocations | customers
            $table->string('entity', 50);                       // morph alias: product_sku, product_price, ...
            $table->uuid('entity_id');
            $table->string('operation', 10);                    // upsert | delete
            $table->dateTime('changed_at');

            $table->index(['stream', 'id']);
            $table->index(['device_id', 'stream', 'id']);
            $table->index(['entity', 'entity_id']);
        });

        Integrity::check('sync_changes', 'sync_changes_operation_check', "operation IN ('upsert', 'delete')");

        Schema::create('sync_cursors', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('device_id')->constrained()->restrictOnDelete();
            $table->string('stream', 30);
            $table->unsignedBigInteger('position')->default(0); // last sync_changes.id applied
            $table->dateTime('last_pulled_at')->nullable();
            $table->datetimes();

            $table->unique(['device_id', 'stream']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_cursors');
        Schema::dropIfExists('sync_changes');
        Schema::dropIfExists('sync_operations');
    }
};
