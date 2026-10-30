<?php

namespace Tests\Feature\Dashboard;

use App\Models\InventoryLevel;
use App\Models\ProductSku;
use App\Models\Setting;
use App\Models\StockBatch;
use Illuminate\Support\Carbon;
use Tests\Feature\Auth\AuthTestCase;

class StockAlertsTest extends AuthTestCase
{
    private function level(string $onHand, string $reorder, array $sku = []): InventoryLevel
    {
        $sku = ProductSku::factory()->create(['reorder_level' => $reorder, ...$sku]);

        return InventoryLevel::factory()->create([
            'store_id' => $this->store->id, 'product_sku_id' => $sku->id, 'quantity_on_hand' => $onHand,
        ]);
    }

    private function batch(int $daysFromToday, string $remaining = '10.0000'): StockBatch
    {
        return StockBatch::factory()->create([
            'store_id' => $this->store->id,
            'expiry_date' => Carbon::now(config('compriva.timezone'))->addDays($daysFromToday)->toDateString(),
            'remaining_quantity' => $remaining,
        ]);
    }

    public function test_lists_low_stock_most_urgent_first(): void
    {
        $this->level('100.0000', '20.0000');                        // fine
        $half = $this->level('10.0000', '20.0000', ['name' => 'Half']);
        $out = $this->level('0.0000', '12.0000', ['name' => 'Out']);
        $this->level('0.0000', '0.0000');                           // no reorder level set: never alerted
        $this->level('1.0000', '5.0000', ['deleted_at' => now()]);  // discontinued: never alerted

        $this->actingAsUser($this->userWithRole('manager'))->getJson('/api/v1/dashboard/stock-alerts')
            ->assertOk()
            ->assertJsonPath('data.low_stock.total', 2)
            ->assertJsonPath('data.low_stock.items.0.sku_id', $out->product_sku_id)
            ->assertJsonPath('data.low_stock.items.1.sku_id', $half->product_sku_id)
            ->assertJsonPath('data.low_stock.items.1.quantity_on_hand', '10.0000')
            ->assertJsonPath('data.low_stock.items.1.reorder_level', '20.0000');
    }

    public function test_lists_batches_expiring_within_the_warning_window(): void
    {
        Setting::create(['group' => 'inventory', 'key' => 'expiry_warning_days', 'value' => 14]);
        $expired = $this->batch(-2);
        $soon = $this->batch(3);
        $this->batch(14);
        $this->batch(15);                 // outside the window
        $this->batch(1, '0.0000');        // nothing left

        $this->actingAsUser($this->userWithRole('owner'))->getJson('/api/v1/dashboard/stock-alerts')
            ->assertOk()
            ->assertJsonPath('data.expiring.window_days', 14)
            ->assertJsonPath('data.expiring.total', 3)
            ->assertJsonPath('data.expiring.items.0.batch_id', $expired->id)
            ->assertJsonPath('data.expiring.items.0.days_left', -2)
            ->assertJsonPath('data.expiring.items.1.batch_id', $soon->id)
            ->assertJsonPath('data.expiring.items.1.days_left', 3);
    }

    public function test_inventory_staff_can_see_alerts_but_cashiers_cannot(): void
    {
        $this->actingAsUser($this->userWithRole('inventory_clerk'))->getJson('/api/v1/dashboard/stock-alerts')->assertOk();

        $this->assertErrorCode(
            $this->actingAsUser($this->userWithRole('cashier'))->getJson('/api/v1/dashboard/stock-alerts'),
            403, 'FORBIDDEN',
        );
    }
}
