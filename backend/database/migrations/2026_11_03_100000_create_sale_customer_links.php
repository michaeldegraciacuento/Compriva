<?php

use App\Support\Database\Integrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A customer added to a sale after it was completed (docs/README.md).
 *
 * Completed sales never change (the customer columns are frozen with the
 * amounts), so the correction is its own record: the sale and its printed
 * receipt stay as they were; the customer's purchase history includes the
 * sale. One link per sale, and only for sales that had no customer.
 * Append-only: a wrong link is reported, never edited away.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_customer_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sale_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('linked_by')->constrained('users')->restrictOnDelete();
            $table->string('reason')->nullable();
            $table->dateTime('created_at');

            $table->index('customer_id');
        });

        Integrity::preventUpdates('sale_customer_links', 'Customer links on sales are append-only.');
        Integrity::preventDeletes('sale_customer_links', 'Customer links on sales cannot be deleted.');
    }

    public function down(): void
    {
        Integrity::dropTrigger('sale_customer_links_prevent_update');
        Integrity::dropTrigger('sale_customer_links_prevent_delete');
        Schema::dropIfExists('sale_customer_links');
    }
};
