<?php

namespace Tests\Feature\Sales;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Models\Device;
use App\Models\InventoryLevel;
use App\Models\Product;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\StockMovement;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\UnitConversion;
use App\Models\User;
use Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Auth\AuthTestCase;

/** A registered terminal, a cashier, a manager with a PIN and a stocked product (₱50 a piece, ₱550 a box of 12). */
abstract class PosTestCase extends AuthTestCase
{
    protected Device $terminal;

    protected User $cashier;

    protected User $manager;

    protected ProductSku $sku;

    protected Unit $piece;

    protected Unit $box;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReferenceDataSeeder::class);

        $this->terminal = Device::factory()->create([
            'store_id' => $this->store->id, 'code' => 'T01', 'install_id' => (string) Str::uuid(), 'status' => DeviceStatus::Active,
        ]);
        $this->cashier = $this->userWithRole('cashier', ['name' => 'Juan Cashier']);
        $this->manager = $this->userWithRole('manager', ['username' => 'maria', 'pin_hash' => '135790']);

        $this->piece = Unit::where('code', 'pc')->firstOrFail();
        $this->box = Unit::where('code', 'box')->firstOrFail();
        $this->sku = $this->product('Corned Beef 150g', '50.00', ['box' => ['12', '550.00']]);
        $this->stockIn($this->sku, '100', '35.00');
    }

    /**
     * @param  array<string, array{0: string, 1: ?string}>  $packs  unit code => [factor, price]
     * @param  array<string, mixed>  $product
     */
    protected function product(string $name, string $price, array $packs = [], string $tax = 'VAT12', array $product = [], string $baseUnit = 'pc'): ProductSku
    {
        $base = Unit::where('code', $baseUnit)->firstOrFail();
        $sku = ProductSku::factory()->create([
            'product_id' => Product::factory()->create(['name' => $name, 'tax_rate_id' => TaxRate::where('code', $tax)->value('id')] + $product)->id,
            'base_unit_id' => $base->id,
            'cost_price' => '35.0000',
        ]);
        UnitConversion::factory()->create(['product_sku_id' => $sku->id, 'unit_id' => $base->id, 'factor' => '1', 'is_sales_unit' => true]);
        ProductPrice::factory()->create(['product_sku_id' => $sku->id, 'unit_id' => $base->id, 'price' => $price]);

        foreach ($packs as $code => [$factor, $packPrice]) {
            $unit = Unit::where('code', $code)->firstOrFail();
            UnitConversion::factory()->create(['product_sku_id' => $sku->id, 'unit_id' => $unit->id, 'factor' => $factor, 'is_sales_unit' => true]);
            if ($packPrice !== null) {
                ProductPrice::factory()->create(['product_sku_id' => $sku->id, 'unit_id' => $unit->id, 'price' => $packPrice]);
            }
        }

        return $sku;
    }

    /** @param array<string, mixed> $line */
    protected function stockIn(ProductSku $sku, string $quantity, string $cost, array $line = []): void
    {
        $this->actingAsUser($this->manager)->postJson('/api/v1/inventory/stock-in', [
            'reason' => 'received',
            'lines' => [['product_sku_id' => $sku->id, 'quantity' => $quantity, 'unit_cost' => $cost, ...$line]],
        ])->assertCreated();
    }

    /** Next requests as $user on the terminal (or on another client's install ID). */
    protected function at(User $user, ?Device $terminal = null): static
    {
        return $this->actingAsUser($user)->withHeader('X-Compriva-Device', (string) ($terminal ?? $this->terminal)->install_id);
    }

    protected function openShift(?User $user = null, string $float = '1000.00'): TestResponse
    {
        return $this->at($user ?? $this->cashier)->postJson('/api/v1/pos/shift', ['opening_float' => $float])->assertCreated();
    }

    /** @param array<string, mixed> $overrides */
    protected function checkout(array $lines, array $payments, array $overrides = [], ?User $as = null): TestResponse
    {
        return $this->at($as ?? $this->cashier)->postJson('/api/v1/pos/checkout', [
            'id' => (string) Str::uuid7(),
            'lines' => $lines,
            'payments' => $payments,
            ...$overrides,
        ]);
    }

    /** @param array<string, mixed> $extra */
    protected function line(string $quantity, ?Unit $unit = null, ?ProductSku $sku = null, array $extra = []): array
    {
        return ['sku_id' => ($sku ?? $this->sku)->id, 'unit_id' => ($unit ?? $this->piece)->id, 'quantity' => $quantity, ...$extra];
    }

    protected function cash(string $amount): array
    {
        return ['method' => 'cash', 'amount' => $amount];
    }

    protected function onHand(?ProductSku $sku = null): string
    {
        return InventoryLevel::where('product_sku_id', ($sku ?? $this->sku)->id)->value('quantity_on_hand');
    }

    protected function assertLedgerMatchesLevels(): void
    {
        foreach (InventoryLevel::all() as $level) {
            $sum = StockMovement::where('product_sku_id', $level->product_sku_id)->sum('quantity');
            $this->assertSame(bcadd((string) $sum, '0', 4), $level->quantity_on_hand, 'ledger and level disagree');
        }
    }

    /** @return array{login: string, secret: string} */
    protected function managerApproval(): array
    {
        return ['login' => 'maria', 'secret' => '135790'];
    }
}
