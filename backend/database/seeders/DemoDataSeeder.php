<?php

namespace Database\Seeders;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Device;
use App\Models\InventoryLevel;
use App\Models\Product;
use App\Models\ProductSku;
use App\Models\Role;
use App\Models\StockAdjustment;
use App\Models\StockBatch;
use App\Models\StockMovement;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\TaxRate;
use App\Models\TerminalStockAllocation;
use App\Models\Unit;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Local demo data: staff, two terminals, a small grocery catalog, opening
 * stock and terminal allocations. Runs once (skipped when products exist).
 *
 * Barcodes use the GS1 restricted-circulation prefix 2 so they can never
 * collide with real product barcodes.
 */
class DemoDataSeeder extends Seeder
{
    private const PRODUCTS = [
        // name, variant, category, brand, base unit, tax, price, cost, typical stock (reorder level = 1/5), [pack unit, factor, pack price], perishable
        ['Coca-Cola Regular', '1.5L', 'Beverages', 'Coca-Cola', 'pc', 'VAT12', '75.0000', '61.5000', 120, ['case', 12, '870.0000'], false],
        ['Coca-Cola Regular', '330ml Can', 'Beverages', 'Coca-Cola', 'pc', 'VAT12', '35.0000', '28.2500', 240, ['case', 24, '816.0000'], false],
        ['Lucky Me! Pancit Canton', 'Original 80g', 'Noodles', 'Lucky Me!', 'pc', 'VAT12', '16.0000', '12.9000', 360, ['box', 72, '1116.0000'], false],
        ['Century Tuna Flakes in Oil', '155g', 'Canned Goods', 'Century Tuna', 'pc', 'VAT12', '42.5000', '35.1000', 144, ['case', 48, '1980.0000'], false],
        ['Bear Brand Powdered Milk', '300g', 'Dairy', 'Nestlé', 'pc', 'VAT12', '115.0000', '96.0000', 60, null, false],
        ['Datu Puti Vinegar', '1L', 'Condiments', 'Datu Puti', 'pc', 'VAT12', '45.0000', '36.5000', 80, ['case', 12, '522.0000'], false],
        ['Jasmine Rice', 'Per kg', 'Rice & Grains', null, 'kg', 'VAT_EXEMPT', '58.0000', '47.0000', 500, ['sack', 25, '1400.0000'], false],
        ['Fresh Eggs', 'Large', 'Dairy', null, 'pc', 'VAT_EXEMPT', '9.5000', '7.6000', 600, ['tray', 30, '275.0000'], true],
        ['Fresh Milk', '1L', 'Dairy', 'Nestlé', 'pc', 'VAT12', '98.0000', '82.0000', 48, null, true],
        ['Banana Lakatan', 'Per kg', 'Fresh Produce', null, 'kg', 'VAT_EXEMPT', '90.0000', '68.0000', 40, null, true],
        ['Surf Powder Detergent', '1kg', 'Household', 'Surf', 'pc', 'VAT12', '120.0000', '99.0000', 60, null, false],
        ['Safeguard Bar Soap', 'Pure White 135g', 'Personal Care', 'Safeguard', 'pc', 'VAT12', '52.0000', '42.0000', 96, ['box', 48, '2400.0000'], false],
    ];

    /** Opening stock below the reorder level, so the dashboard shows low-stock alerts. */
    private const LOW_OPENING_STOCK = ['Fresh Milk' => 6, 'Bear Brand Powdered Milk' => 9, 'Safeguard Bar Soap' => 0];

    /** Days until the opening batch of each perishable expires (expiry alerts). */
    private const EXPIRY_DAYS = ['Fresh Milk' => 3, 'Banana Lakatan' => 2, 'Fresh Eggs' => 5];

    private int $barcodeSequence = 0;

    public function run(): void
    {
        if (Product::exists()) {
            return;
        }

        DB::transaction(function () {
            $store = Store::where('code', config('compriva.seed.store_code'))->firstOrFail();
            $owner = User::where('username', config('compriva.seed.owner_username'))->firstOrFail();

            $this->staff();
            $devices = $this->devices($store);
            $this->extraUnits();
            $suppliers = $this->suppliers();
            $skus = $this->catalog($owner);
            $this->customers();
            $this->openingStock($store, $owner, $skus);
            $this->allocations($store, $devices, $skus, $owner);

            $this->command?->info(sprintf('Demo data: %d SKUs, %d terminals, %d suppliers.',
                count($skus), count($devices), count($suppliers)));
        });
    }

    private function staff(): void
    {
        $staff = [
            ['Maria Santos', 'manager', 'manager', '246810'],   // PIN: offline sign-in and approvals at terminals
            ['Juan Dela Cruz', 'cashier1', 'cashier', '482916'],
            ['Ana Reyes', 'cashier2', 'cashier', '739215'],
            ['Pedro Garcia', 'clerk', 'inventory_clerk', null],
        ];

        foreach ($staff as [$name, $username, $role, $pin]) {
            $user = User::create(['name' => $name, 'username' => $username, 'password' => 'password', 'pin_hash' => $pin]);
            $user->roles()->attach(Role::where('name', $role)->value('id'));
        }
    }

    /** @return list<Device> */
    private function devices(Store $store): array
    {
        return array_map(fn (int $n) => Device::create([
            'store_id' => $store->id,
            'code' => sprintf('T%02d', $n),
            'name' => "Checkout lane {$n}",
            'status' => 'active',
        ]), [1, 2]);
    }

    private function extraUnits(): void
    {
        foreach ([['sack', 'Sack']] as [$code, $name]) {
            Unit::firstOrCreate(['code' => $code], ['name' => $name, 'type' => 'count']);
        }
    }

    /** @return list<Supplier> */
    private function suppliers(): array
    {
        return array_map(fn (array $s) => Supplier::create([
            'code' => $s[0], 'name' => $s[1], 'contact_person' => $s[2], 'phone' => $s[3], 'payment_terms_days' => $s[4],
        ]), [
            ['SUP-001', 'Metro Beverage Distributors', 'Liza Tan', '0917 555 0101', 30],
            ['SUP-002', 'Luzon Grocery Wholesale', 'Ramon Cruz', '0918 555 0202', 15],
            ['SUP-003', 'Bulacan Farm Fresh', 'Nena Bautista', '0919 555 0303', 0],
        ]);
    }

    /** @return list<array{sku: ProductSku, qty: int, cost: string, perishable: bool}> */
    private function catalog(User $owner): array
    {
        $units = Unit::pluck('id', 'code');
        $taxRates = TaxRate::pluck('id', 'code');
        $skus = [];

        foreach (self::PRODUCTS as $i => [$name, $variant, $category, $brand, $unit, $tax, $price, $cost, $qty, $pack, $perishable]) {
            $product = Product::create([
                'category_id' => Category::firstOrCreate(['slug' => Str::slug($category)], ['name' => $category])->id,
                'brand_id' => $brand ? Brand::firstOrCreate(['slug' => Str::slug($brand)], ['name' => $brand])->id : null,
                'tax_rate_id' => $taxRates[$tax],
                'name' => $name,
                'track_batches' => $perishable,
                'track_expiry' => $perishable,
            ]);

            $sku = $product->skus()->create([
                'base_unit_id' => $units[$unit],
                'code' => sprintf('SKU-%04d', $i + 1),
                'name' => "{$name} {$variant}",
                'variant' => $variant,
                'cost_price' => $cost,
                'reorder_level' => (string) intdiv($qty, 5),
                'reorder_quantity' => (string) intdiv($qty, 2),
            ]);

            $sku->unitConversions()->create(['unit_id' => $units[$unit], 'factor' => '1', 'is_purchase_unit' => $pack === null]);
            $sku->barcodes()->create(['barcode' => $this->nextBarcode(), 'is_primary' => true]);
            $sku->prices()->create([
                'unit_id' => $units[$unit], 'price' => $price, 'effective_from' => now()->subMonth(), 'created_by' => $owner->id,
            ]);

            if ($pack !== null) {
                [$packUnit, $factor, $packPrice] = $pack;
                $sku->unitConversions()->create(['unit_id' => $units[$packUnit], 'factor' => (string) $factor, 'is_purchase_unit' => true]);
                $sku->barcodes()->create(['barcode' => $this->nextBarcode(), 'unit_id' => $units[$packUnit]]);
                $sku->prices()->create([
                    'unit_id' => $units[$packUnit], 'price' => $packPrice, 'effective_from' => now()->subMonth(), 'created_by' => $owner->id,
                ]);
            }

            $skus[] = [
                'sku' => $sku,
                'qty' => self::LOW_OPENING_STOCK[$name] ?? $qty,
                'cost' => $cost,
                'perishable' => $perishable,
                'expiry_days' => self::EXPIRY_DAYS[$name] ?? 14,
            ];
        }

        return $skus;
    }

    private function customers(): void
    {
        Customer::create(['code' => 'C-0001', 'name' => 'Lola Carmen Villanueva', 'type' => 'senior_citizen', 'id_number' => 'SC-QC-2019-04411', 'phone' => '0920 555 0404']);
        Customer::create(['code' => 'C-0002', 'name' => 'Sari-Sari ni Aling Rosa', 'type' => 'business', 'tin' => '123-456-789-000', 'phone' => '0921 555 0505']);
        Customer::create(['code' => 'C-0003', 'name' => 'Mark Aquino', 'phone' => '0922 555 0606', 'email' => 'mark.aquino@example.com']);
    }

    /** Opening balance as a posted stock adjustment, with batches for perishables. */
    private function openingStock(Store $store, User $owner, array $skus): void
    {
        $adjustment = StockAdjustment::create([
            'store_id' => $store->id,
            'adjustment_number' => 'ADJ-000001',
            'reason' => 'opening_balance',
            'created_by' => $owner->id,
            'approved_by' => $owner->id,
        ]);

        foreach ($skus as ['sku' => $sku, 'qty' => $qty, 'cost' => $cost, 'perishable' => $perishable, 'expiry_days' => $expiryDays]) {
            InventoryLevel::create([
                'store_id' => $store->id,
                'product_sku_id' => $sku->id,
                'quantity_on_hand' => (string) $qty,
                'average_cost' => $cost,
                'last_movement_at' => $qty > 0 ? now() : null,
            ]);

            if ($qty === 0) {
                continue; // out of stock: no batch, no movement (movements are never zero)
            }

            $batch = $perishable ? StockBatch::create([
                'store_id' => $store->id,
                'product_sku_id' => $sku->id,
                'batch_number' => 'OPEN-'.$sku->code,
                'expiry_date' => now(config('compriva.timezone'))->addDays($expiryDays)->toDateString(),
                'unit_cost' => $cost,
                'initial_quantity' => (string) $qty,
                'remaining_quantity' => (string) $qty,
                'received_at' => now(),
            ]) : null;

            $adjustment->items()->create([
                'product_sku_id' => $sku->id,
                'stock_batch_id' => $batch?->id,
                'system_quantity' => '0',
                'counted_quantity' => (string) $qty,
                'quantity_change' => (string) $qty,
                'unit_cost' => $cost,
            ]);

            StockMovement::create([
                'store_id' => $store->id,
                'product_sku_id' => $sku->id,
                'stock_batch_id' => $batch?->id,
                'type' => 'opening_balance',
                'quantity' => (string) $qty,
                'unit_cost' => $cost,
                'reference_type' => 'stock_adjustment',
                'reference_id' => $adjustment->id,
                'occurred_at' => now(),
                'created_by' => $owner->id,
            ]);
        }

        $adjustment->update(['status' => 'posted', 'posted_at' => now()]);
    }

    /** Each terminal gets 10% of opening stock to sell offline (nothing when out of stock). */
    private function allocations(Store $store, array $devices, array $skus, User $owner): void
    {
        foreach ($skus as ['sku' => $sku, 'qty' => $qty]) {
            if ($qty === 0) {
                continue;
            }
            $share = (string) max(1, intdiv($qty, 10));

            foreach ($devices as $device) {
                $allocation = TerminalStockAllocation::create([
                    'store_id' => $store->id,
                    'device_id' => $device->id,
                    'product_sku_id' => $sku->id,
                    'allocated_quantity' => $share,
                    'last_event_at' => now(),
                ]);
                $allocation->events()->create([
                    'type' => 'allocate', 'quantity' => $share, 'created_by' => $owner->id, 'occurred_at' => now(),
                ]);
            }

            InventoryLevel::where('store_id', $store->id)->where('product_sku_id', $sku->id)
                ->update(['quantity_allocated' => bcmul($share, (string) count($devices), 4)]);
        }
    }

    /** EAN-13 in the restricted-circulation range 200xxxxxxxxx + check digit. */
    private function nextBarcode(): string
    {
        $body = sprintf('200%09d', ++$this->barcodeSequence);
        $sum = 0;
        foreach (str_split($body) as $i => $digit) {
            $sum += (int) $digit * ($i % 2 === 0 ? 1 : 3);
        }

        return $body.((10 - $sum % 10) % 10);
    }
}
