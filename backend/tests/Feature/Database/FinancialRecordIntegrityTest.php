<?php

namespace Tests\Feature\Database;

use App\Domain\Sales\Enums\SaleStatus;
use App\Models\CashierShift;
use App\Models\CashMovement;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Refund;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use App\Models\User;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Support\Facades\DB;

/** Completed sales, payments, returns and shifts are preserved. */
class FinancialRecordIntegrityTest extends DatabaseTestCase
{
    public function test_sale_ids_generated_offline_are_kept(): void
    {
        $offlineId = '019a3b2c-1d4e-7f00-8a1b-2c3d4e5f6a7b';

        $sale = Sale::factory()->create(['id' => $offlineId]);

        $this->assertSame($offlineId, $sale->id);
        $this->assertDatabaseHas('sales', ['id' => $offlineId]);
    }

    public function test_models_generate_uuid_v7_keys(): void
    {
        $user = User::factory()->create();

        $this->assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $user->id);
    }

    public function test_completed_sales_cannot_be_deleted(): void
    {
        $sale = Sale::factory()->create();

        $this->expectException(ImmutableRecordException::class);
        $sale->delete();
    }

    public function test_database_rejects_deleting_a_sale_directly(): void
    {
        $sale = Sale::factory()->create();

        $this->assertDatabaseRejects(fn () => DB::table('sales')->where('id', $sale->id)->delete(), [self::TRIGGER], 'cannot be deleted');
    }

    public function test_sale_amounts_are_frozen(): void
    {
        $sale = Sale::factory()->create();

        $this->assertDatabaseRejects(
            fn () => DB::table('sales')->where('id', $sale->id)->update(['grand_total' => '1.0000']),
            [self::TRIGGER],
            'cannot be modified',
        );

        $this->expectException(ImmutableRecordException::class);
        $sale->update(['grand_total' => '1.0000']);
    }

    public function test_a_sale_can_be_voided_once_and_then_never_changed(): void
    {
        $sale = Sale::factory()->create();
        $manager = User::factory()->create();

        $sale->update(['status' => 'voided', 'voided_at' => now(), 'voided_by' => $manager->id, 'void_reason' => 'Wrong item']);
        $this->assertSame(SaleStatus::Voided, $sale->fresh()->status);

        $this->assertDatabaseRejects(
            fn () => DB::table('sales')->where('id', $sale->id)->update(['status' => 'completed', 'voided_at' => null]),
            [self::TRIGGER],
            'voided sale cannot be changed',
        );
    }

    public function test_void_requires_void_details(): void
    {
        $sale = Sale::factory()->create();

        $this->assertCheckFails(
            fn () => DB::table('sales')->where('id', $sale->id)->update(['status' => 'voided']),
            'sales_status_check',
        );
    }

    public function test_sale_must_be_fully_paid(): void
    {
        $this->assertCheckFails(
            fn () => Sale::factory()->create(['grand_total' => '100.0000', 'amount_paid' => '90.0000']),
            'sales_payment_check',
        );
    }

    public function test_sale_items_and_payments_are_append_only(): void
    {
        $item = SaleItem::factory()->create();
        $payment = Payment::factory()->create(['sale_id' => $item->sale_id]);

        foreach (['sale_items' => $item->id, 'payments' => $payment->id] as $table => $id) {
            $this->assertDatabaseRejects(fn () => DB::table($table)->where('id', $id)->update(['created_at' => now()]), [self::TRIGGER]);
            $this->assertDatabaseRejects(fn () => DB::table($table)->where('id', $id)->delete(), [self::TRIGGER]);
        }

        $this->expectException(ImmutableRecordException::class);
        $item->delete();
    }

    public function test_payment_change_must_match_tender(): void
    {
        $this->assertCheckFails(
            fn () => Payment::factory()->create(['amount' => '100.0000', 'tendered_amount' => '500.0000', 'change_amount' => '300.0000']),
            'payments_amounts_check',
        );
    }

    public function test_sale_items_keep_their_historical_snapshot(): void
    {
        $item = SaleItem::factory()->create(['product_name' => 'Coca-Cola 1.5L', 'unit_price' => '75.0000']);
        $product = $item->sku->product;

        $product->update(['name' => 'Coca-Cola Original Taste 1.5L']);
        $item->sku->update(['name' => 'Renamed SKU']);

        $this->assertSame('Coca-Cola 1.5L', $item->fresh()->product_name);
        $this->assertSame('75.0000', $item->fresh()->unit_price);
    }

    public function test_products_with_sales_cannot_be_hard_deleted(): void
    {
        $item = SaleItem::factory()->create();

        $this->assertDatabaseRejects(fn () => DB::table('product_skus')->where('id', $item->product_sku_id)->delete(), [self::CONSTRAINT]);

        // Soft deletion (deactivation) remains possible and keeps the sale intact.
        $item->sku->delete();
        $this->assertSoftDeleted('product_skus', ['id' => $item->product_sku_id]);
        $this->assertNotNull($item->fresh()->sku()->withTrashed()->first());
        $this->assertSame(1, Product::withTrashed()->count());
    }

    public function test_receipt_sequence_is_unique_per_terminal(): void
    {
        $sale = Sale::factory()->create();

        $this->assertDatabaseRejects(fn () => Sale::factory()->create([
            'device_id' => $sale->device_id,
            'receipt_sequence' => $sale->receipt_sequence,
            'receipt_number' => 'OTHER-1',
        ]), [self::CONSTRAINT]);
    }

    public function test_sync_operation_ids_cannot_create_two_sales(): void
    {
        $sale = Sale::factory()->create();

        $this->assertDatabaseRejects(fn () => Sale::factory()->create(['operation_id' => $sale->operation_id]), [self::CONSTRAINT]);
    }

    public function test_only_one_open_shift_per_terminal(): void
    {
        $shift = CashierShift::factory()->create();

        $this->assertDatabaseRejects(
            fn () => CashierShift::factory()->create(['device_id' => $shift->device_id]),
            [self::CONSTRAINT],
            'open_device_key',
        );

        // Closing the shift frees the terminal for the next cashier.
        $shift->update(['status' => 'closed', 'closed_at' => now(), 'counted_cash' => '2000.0000']);
        $next = CashierShift::factory()->create(['device_id' => $shift->device_id]);

        $this->assertNotSame($shift->id, $next->id);
    }

    public function test_closed_shifts_are_frozen_and_shifts_are_never_deleted(): void
    {
        $shift = CashierShift::factory()->closed()->create();

        $this->assertDatabaseRejects(
            fn () => DB::table('cashier_shifts')->where('id', $shift->id)->update(['counted_cash' => '1.0000']),
            [self::TRIGGER],
            'closed shift',
        );
        $this->assertDatabaseRejects(fn () => DB::table('cashier_shifts')->where('id', $shift->id)->delete(), [self::TRIGGER]);
    }

    public function test_cash_movements_are_append_only_and_positive(): void
    {
        $movement = CashMovement::factory()->create();

        $this->assertDatabaseRejects(fn () => DB::table('cash_movements')->where('id', $movement->id)->delete(), [self::TRIGGER]);
        $this->assertCheckFails(fn () => CashMovement::factory()->create(['amount' => '-5.0000']), 'cash_movements_amount_check');
    }

    public function test_returns_and_refunds_are_append_only(): void
    {
        $item = SaleItem::factory()->create();
        $return = SaleReturn::factory()->create(['sale_id' => $item->sale_id]);
        $returnItem = SaleReturnItem::factory()->create(['sale_return_id' => $return->id, 'sale_item_id' => $item->id]);
        $refund = Refund::factory()->create(['sale_return_id' => $return->id]);

        foreach (['sale_returns' => $return->id, 'sale_return_items' => $returnItem->id, 'refunds' => $refund->id] as $table => $id) {
            $this->assertDatabaseRejects(fn () => DB::table($table)->where('id', $id)->delete(), [self::TRIGGER]);
        }

        // The original sale is still there and still completed.
        $this->assertSame(SaleStatus::Completed, $item->sale->fresh()->status);
        $this->assertCount(1, $item->sale->returns);
    }
}
