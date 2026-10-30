<?php

namespace Tests\Feature\Database;

use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\ProductSku;
use App\Models\StockAdjustment;
use App\Models\StockAdjustmentItem;
use App\Models\StockAllocationEvent;
use App\Models\StockBatch;
use App\Models\StockMovement;
use App\Models\TerminalStockAllocation;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Support\Facades\DB;

/** Stock ledger, posted documents, batches and terminal allocations. */
class InventoryIntegrityTest extends DatabaseTestCase
{
    public function test_stock_movements_are_append_only(): void
    {
        $movement = StockMovement::factory()->create();

        $this->assertDatabaseRejects(
            fn () => DB::table('stock_movements')->where('id', $movement->id)->update(['quantity' => '999.0000']),
            [self::TRIGGER],
            'append-only',
        );
        $this->assertDatabaseRejects(fn () => DB::table('stock_movements')->where('id', $movement->id)->delete(), [self::TRIGGER]);

        $this->expectException(ImmutableRecordException::class);
        $movement->update(['quantity' => '999.0000']);
    }

    public function test_corrections_are_new_movements(): void
    {
        $in = StockMovement::factory()->create(['quantity' => '10.0000']);
        StockMovement::factory()->create([
            'store_id' => $in->store_id, 'product_sku_id' => $in->product_sku_id, 'type' => 'adjustment', 'quantity' => '-3.0000',
        ]);

        $this->assertSame('7.0000', StockMovement::where('product_sku_id', $in->product_sku_id)->sum('quantity'));
    }

    public function test_stock_movement_quantity_cannot_be_zero(): void
    {
        $this->assertCheckFails(fn () => StockMovement::factory()->create(['quantity' => '0']), 'stock_movements_quantity_check');
    }

    public function test_posted_stock_adjustments_are_locked(): void
    {
        $adjustment = StockAdjustment::factory()->create();
        $item = StockAdjustmentItem::factory()->create(['stock_adjustment_id' => $adjustment->id]);

        // Drafts are editable.
        $item->update(['notes' => 'recounted']);
        $adjustment->update(['status' => 'posted', 'posted_at' => now()]);

        $this->assertDatabaseRejects(fn () => DB::table('stock_adjustments')->where('id', $adjustment->id)->update(['notes' => 'x']), [self::TRIGGER]);
        $this->assertDatabaseRejects(fn () => DB::table('stock_adjustment_items')->where('id', $item->id)->update(['notes' => 'x']), [self::TRIGGER]);
        $this->assertDatabaseRejects(fn () => DB::table('stock_adjustment_items')->where('id', $item->id)->delete(), [self::TRIGGER]);
        $this->assertDatabaseRejects(
            fn () => StockAdjustmentItem::factory()->create(['stock_adjustment_id' => $adjustment->id]),
            [self::TRIGGER],
            'Posted stock_adjustments',
        );

        $this->expectException(ImmutableRecordException::class);
        $adjustment->fresh()->delete();
    }

    public function test_posted_goods_receipts_are_locked(): void
    {
        $receipt = GoodsReceipt::factory()->create();
        GoodsReceiptItem::factory()->create(['goods_receipt_id' => $receipt->id]);
        $receipt->update(['status' => 'posted', 'posted_at' => now()]);

        $this->assertDatabaseRejects(
            fn () => GoodsReceiptItem::factory()->create(['goods_receipt_id' => $receipt->id]),
            [self::TRIGGER],
        );
        $this->assertDatabaseRejects(fn () => DB::table('goods_receipts')->where('id', $receipt->id)->delete(), [self::TRIGGER]);
    }

    public function test_batch_remaining_quantity_stays_within_received_quantity(): void
    {
        $this->assertCheckFails(
            fn () => StockBatch::factory()->create(['initial_quantity' => '10.0000', 'remaining_quantity' => '11.0000']),
            'stock_batches_quantity_check',
        );
        $this->assertCheckFails(
            fn () => StockBatch::factory()->create(['remaining_quantity' => '-1.0000']),
            'stock_batches_quantity_check',
        );
    }

    public function test_one_allocation_per_terminal_and_sku(): void
    {
        $allocation = TerminalStockAllocation::factory()->create();

        $this->assertDatabaseRejects(fn () => TerminalStockAllocation::factory()->create([
            'device_id' => $allocation->device_id, 'product_sku_id' => $allocation->product_sku_id,
        ]), [self::CONSTRAINT]);
    }

    public function test_allocation_balance_rules(): void
    {
        $allocation = TerminalStockAllocation::factory()->create(['allocated_quantity' => '20.0000']);

        // Selling beyond the allocation offline is allowed (flagged on the sale line) …
        $allocation->update(['consumed_quantity' => '23.0000']);
        $this->assertSame('-3.0000', $allocation->availableQuantity());

        // … but more cannot be released than was allocated.
        $this->assertCheckFails(
            fn () => DB::table('terminal_stock_allocations')->where('id', $allocation->id)->update(['released_quantity' => '21.0000']),
            'terminal_stock_allocations_quantity_check',
        );
    }

    public function test_allocation_events_are_append_only(): void
    {
        $event = StockAllocationEvent::factory()->create();

        $this->assertDatabaseRejects(fn () => DB::table('stock_allocation_events')->where('id', $event->id)->delete(), [self::TRIGGER]);
        $this->assertCheckFails(fn () => StockAllocationEvent::factory()->create(['quantity' => '0']), 'stock_allocation_events_check');
    }

    public function test_conversion_factors_must_be_positive_and_unique_per_unit(): void
    {
        $sku = ProductSku::factory()->create();
        $sku->unitConversions()->create(['unit_id' => $sku->base_unit_id, 'factor' => '1']);

        $this->assertDatabaseRejects(fn () => $sku->unitConversions()->create(['unit_id' => $sku->base_unit_id, 'factor' => '2']), [self::CONSTRAINT]);
        $this->assertCheckFails(
            fn () => DB::table('unit_conversions')->where('product_sku_id', $sku->id)->update(['factor' => '0']),
            'unit_conversions_factor_check',
        );
    }
}
