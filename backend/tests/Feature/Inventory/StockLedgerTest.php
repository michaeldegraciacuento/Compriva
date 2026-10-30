<?php

namespace Tests\Feature\Inventory;

use App\Domain\Inventory\Services\StockLedger;
use App\Models\InventoryLevel;
use App\Models\Product;
use App\Models\ProductSku;
use App\Models\StockAdjustment;
use App\Models\StockBatch;
use App\Models\StockMovement;
use App\Models\Unit;
use App\Models\User;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Support\Carbon;
use Tests\Feature\Auth\AuthTestCase;

/** Every stock change goes through the StockLedger and leaves stock movements. */
class StockLedgerTest extends AuthTestCase
{
    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->manager = $this->userWithRole('manager');
    }

    private function sku(array $product = [], array $unit = []): ProductSku
    {
        return ProductSku::factory()->create([
            'product_id' => Product::factory()->create($product)->id,
            'base_unit_id' => Unit::factory()->create($unit)->id,
            'reorder_level' => '5.0000',
        ]);
    }

    private function onHand(ProductSku $sku): string
    {
        return InventoryLevel::where('product_sku_id', $sku->id)->value('quantity_on_hand') ?? '0.0000';
    }

    private function stockIn(ProductSku $sku, string $quantity, string $cost, array $line = [], ?User $as = null)
    {
        return $this->actingAsUser($as ?? $this->manager)->postJson('/api/v1/inventory/stock-in', [
            'reason' => 'received',
            'reference' => 'DR-1001',
            'lines' => [['product_sku_id' => $sku->id, 'quantity' => $quantity, 'unit_cost' => $cost, ...$line]],
        ]);
    }

    private function stockOut(ProductSku $sku, string $quantity, array $line = [], ?User $as = null)
    {
        return $this->actingAsUser($as ?? $this->manager)->postJson('/api/v1/inventory/stock-out', [
            'reason' => 'damage',
            'lines' => [['product_sku_id' => $sku->id, 'quantity' => $quantity, ...$line]],
        ]);
    }

    private function assertLedgerMatchesLevels(): void
    {
        foreach (InventoryLevel::all() as $level) {
            $sum = StockMovement::where('product_sku_id', $level->product_sku_id)->sum('quantity');
            $this->assertSame(bcadd((string) $sum, '0', 4), $level->quantity_on_hand, 'ledger and level disagree');
        }
    }

    public function test_stock_in_posts_movement_level_cost_and_number(): void
    {
        $sku = $this->sku();

        $this->stockIn($sku, '24', '50')
            ->assertCreated()
            ->assertJsonPath('data.number', 'SI-000001')
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.quantity_change', '24.0000');

        $this->assertSame('24.0000', $this->onHand($sku));
        $movement = StockMovement::where('product_sku_id', $sku->id)->sole();
        $this->assertSame('stock_in', $movement->type->value);
        $this->assertSame('24.0000', $movement->quantity);
        $this->assertSame('stock_adjustment', $movement->reference_type);
        $this->assertSame('50.0000', $sku->fresh()->cost_price);
    }

    public function test_stock_in_converts_purchase_units_and_cost_to_base_units(): void
    {
        $sku = $this->sku();
        $case = Unit::factory()->create(['code' => 'case', 'name' => 'Case']);
        $sku->unitConversions()->create(['unit_id' => $case->id, 'factor' => '12']);

        $this->stockIn($sku, '2', '600', ['unit_id' => $case->id])->assertCreated();

        $this->assertSame('24.0000', $this->onHand($sku));
        $this->assertSame('50.0000', InventoryLevel::where('product_sku_id', $sku->id)->value('average_cost'));
    }

    public function test_weighted_average_cost(): void
    {
        $sku = $this->sku();
        $this->stockIn($sku, '10', '50')->assertCreated();
        $this->stockIn($sku, '30', '70')->assertCreated();

        $this->assertSame('65.0000', InventoryLevel::where('product_sku_id', $sku->id)->value('average_cost')); // (500 + 2100) / 40
        $this->assertSame('SI-000002', StockAdjustment::latest('adjustment_number')->value('adjustment_number'));
    }

    public function test_whole_units_and_decimal_units(): void
    {
        $pieces = $this->sku();
        $kilos = $this->sku(unit: ['code' => 'kg', 'name' => 'Kilogram', 'type' => 'weight', 'allows_decimal' => true]);

        $this->stockIn($pieces, '1.5', '10')->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['fields' => ['lines.0.quantity']]]]);
        $this->stockIn($kilos, '1.25', '58')->assertCreated();
        $this->assertSame('1.2500', $this->onHand($kilos));
    }

    public function test_expiry_tracked_products_need_an_expiry_and_create_batches(): void
    {
        $sku = $this->sku(['track_expiry' => true]);

        $this->stockIn($sku, '10', '20')->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['fields' => ['lines.0.expiry_date']]]]);

        $expiry = now()->addDays(20)->toDateString();
        $this->stockIn($sku, '10', '20', ['batch_number' => 'LOT-A', 'expiry_date' => $expiry])->assertCreated();
        $this->stockIn($sku, '5', '20', ['batch_number' => 'LOT-A', 'expiry_date' => $expiry])->assertCreated();

        $batch = StockBatch::where('product_sku_id', $sku->id)->sole();
        $this->assertSame(['15.0000', '15.0000'], [$batch->initial_quantity, $batch->remaining_quantity]);
        $this->assertSame(2, StockMovement::where('stock_batch_id', $batch->id)->count());
    }

    public function test_stock_out_uses_fefo_across_batches(): void
    {
        $sku = $this->sku(['track_expiry' => true]);
        $this->stockIn($sku, '5', '10', ['batch_number' => 'LATE', 'expiry_date' => now()->addDays(30)->toDateString()]);
        $this->stockIn($sku, '5', '12', ['batch_number' => 'SOON', 'expiry_date' => now()->addDays(3)->toDateString()]);
        $this->stockIn($sku, '5', '11', ['batch_number' => 'MID', 'expiry_date' => now()->addDays(10)->toDateString()]);

        $this->stockOut($sku, '7')->assertCreated();

        $remaining = StockBatch::where('product_sku_id', $sku->id)->pluck('remaining_quantity', 'batch_number')->all();
        $this->assertSame(['LATE' => '5.0000', 'MID' => '3.0000', 'SOON' => '0.0000'], collect($remaining)->sortKeys()->all());
        $this->assertSame('8.0000', $this->onHand($sku));

        $out = StockMovement::where('type', 'stock_out')->with('batch')->get();
        $this->assertSame(['SOON' => '-5.0000', 'MID' => '-2.0000'], $out->mapWithKeys(fn ($m) => [$m->batch->batch_number => $m->quantity])->all());
        $this->assertSame('12.0000', $out->firstWhere('batch.batch_number', 'SOON')->unit_cost); // batch cost, not average
    }

    public function test_stock_out_cannot_exceed_available_stock_and_changes_nothing(): void
    {
        $sku = $this->sku();
        $this->stockIn($sku, '10', '50');
        InventoryLevel::where('product_sku_id', $sku->id)->update(['quantity_allocated' => '4.0000']); // reserved for terminals

        $this->assertErrorCode($this->stockOut($sku, '7'), 422, 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.available', '6.0000');

        $this->assertSame('10.0000', $this->onHand($sku));
        $this->assertSame(0, StockAdjustment::where('type', 'stock_out')->count()); // the whole document rolled back
        $this->stockOut($sku, '6')->assertCreated();
    }

    public function test_a_failing_line_rolls_back_the_whole_document(): void
    {
        $plenty = $this->sku();
        $scarce = $this->sku();
        $this->stockIn($plenty, '10', '5');
        $this->stockIn($scarce, '1', '5');

        $this->actingAsUser($this->manager)->postJson('/api/v1/inventory/stock-out', [
            'reason' => 'damage',
            'lines' => [['product_sku_id' => $plenty->id, 'quantity' => '3'], ['product_sku_id' => $scarce->id, 'quantity' => '2']],
        ])->assertUnprocessable();

        $this->assertSame('10.0000', $this->onHand($plenty));
        $this->assertSame(0, StockMovement::where('type', 'stock_out')->count());
    }

    public function test_count_adjustment_records_the_difference(): void
    {
        $sku = $this->sku();
        $this->stockIn($sku, '10', '50');

        $this->actingAsUser($this->manager)->postJson('/api/v1/inventory/adjustments', [
            'reason' => 'count_correction',
            'lines' => [['product_sku_id' => $sku->id, 'counted_quantity' => '8']],
        ])->assertCreated()
            ->assertJsonPath('data.number', 'ADJ-000001')
            ->assertJsonPath('data.lines.0.system_quantity', '10.0000')
            ->assertJsonPath('data.lines.0.quantity_change', '-2.0000');

        $this->assertSame('8.0000', $this->onHand($sku));

        $this->actingAsUser($this->manager)->postJson('/api/v1/inventory/adjustments', [
            'reason' => 'count_correction',
            'lines' => [['product_sku_id' => $sku->id, 'counted_quantity' => '8']],
        ])->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['fields' => ['lines.0.counted_quantity']]]]);
    }

    public function test_reasons_must_fit_the_document_type(): void
    {
        $sku = $this->sku();

        $this->actingAsUser($this->manager)->postJson('/api/v1/inventory/stock-in', [
            'reason' => 'theft',
            'lines' => [['product_sku_id' => $sku->id, 'quantity' => '1', 'unit_cost' => '1']],
        ])->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['fields' => ['reason']]]]);
    }

    public function test_inventory_clerk_drafts_and_a_manager_approves(): void
    {
        $sku = $this->sku();
        $clerk = $this->userWithRole('inventory_clerk');

        $id = $this->stockIn($sku, '12', '40', as: $clerk)
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->json('data.id');
        $this->assertSame('0.0000', $this->onHand($sku)); // drafts never change stock

        $this->assertErrorCode($this->actingAsUser($clerk)->postJson("/api/v1/inventory/documents/{$id}/approve"), 403, 'FORBIDDEN');

        $this->actingAsUser($this->manager)->postJson("/api/v1/inventory/documents/{$id}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.approved_by.id', $this->manager->id);
        $this->assertSame('12.0000', $this->onHand($sku));

        $this->assertErrorCode($this->actingAsUser($this->manager)->postJson("/api/v1/inventory/documents/{$id}/approve"), 409, 'CONFLICT');
        $this->assertErrorCode($this->actingAsUser($this->manager)->deleteJson("/api/v1/inventory/documents/{$id}"), 409, 'CONFLICT');
    }

    public function test_authors_can_withdraw_their_own_drafts(): void
    {
        $sku = $this->sku();
        $clerk = $this->userWithRole('inventory_clerk');
        $other = $this->userWithRole('inventory_clerk');
        $id = $this->stockIn($sku, '1', '1', as: $clerk)->json('data.id');

        $this->assertErrorCode($this->actingAsUser($other)->deleteJson("/api/v1/inventory/documents/{$id}"), 403, 'FORBIDDEN');
        $this->actingAsUser($clerk)->deleteJson("/api/v1/inventory/documents/{$id}")->assertNoContent();

        $this->assertDatabaseMissing('stock_adjustments', ['id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['event' => 'stock_document.rejected', 'auditable_id' => $id]);
    }

    public function test_inventory_quantities_cannot_change_silently(): void
    {
        $sku = $this->sku();
        $this->stockIn($sku, '10', '50');
        $level = InventoryLevel::where('product_sku_id', $sku->id)->first();

        $this->assertFalse(StockLedger::isWriting());
        $this->expectException(ImmutableRecordException::class);
        $level->update(['quantity_on_hand' => '999']);
    }

    public function test_ledger_and_levels_always_agree(): void
    {
        $a = $this->sku(['track_expiry' => true]);
        $b = $this->sku();
        $this->stockIn($a, '10', '10', ['batch_number' => 'X', 'expiry_date' => now()->addDays(5)->toDateString()]);
        $this->stockIn($b, '20', '3');
        $this->stockOut($a, '4');
        $this->stockOut($b, '7');
        $this->actingAsUser($this->manager)->postJson('/api/v1/inventory/adjustments', [
            'reason' => 'count_correction',
            'lines' => [['product_sku_id' => $b->id, 'counted_quantity' => '15']],
        ])->assertCreated();

        $this->assertLedgerMatchesLevels();
        $this->assertSame('6.0000', StockBatch::where('product_sku_id', $a->id)->value('remaining_quantity'));
    }

    public function test_history_batches_and_overview_endpoints(): void
    {
        $sku = $this->sku(['track_expiry' => true]);
        $this->stockIn($sku, '3', '10', ['batch_number' => 'OLD', 'expiry_date' => Carbon::now(config('compriva.timezone'))->subDay()->toDateString()]);
        $this->stockIn($sku, '2', '10', ['batch_number' => 'NEW', 'expiry_date' => now()->addDays(90)->toDateString()]);
        $quiet = $this->sku();

        $this->actingAsUser($this->manager)->getJson("/api/v1/inventory/movements?sku_id={$sku->id}")
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.reference.number', 'SI-000002');

        $this->getJson('/api/v1/inventory/batches?status=expired')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.batch_number', 'OLD')->assertJsonPath('data.0.days_left', -1);

        $this->getJson('/api/v1/inventory/stock?status=low')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.sku_id', $sku->id)->assertJsonPath('data.0.status', 'low');
        $this->getJson('/api/v1/inventory/stock?status=out')
            ->assertOk()->assertJsonPath('data.0.sku_id', $quiet->id)
            ->assertJsonPath('summary.out_of_stock', 1)->assertJsonPath('summary.low_stock', 1)->assertJsonPath('summary.stock_value', '50.0000');
    }

    public function test_cashiers_cannot_use_inventory(): void
    {
        $cashier = $this->userWithRole('cashier');

        $this->assertErrorCode($this->actingAsUser($cashier)->getJson('/api/v1/inventory/stock'), 403, 'FORBIDDEN');
        $this->assertErrorCode($this->stockIn($this->sku(), '1', '1', as: $cashier), 403, 'FORBIDDEN');
    }
}
