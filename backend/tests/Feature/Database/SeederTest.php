<?php

namespace Tests\Feature\Database;

use App\Domain\Identity\Permissions;
use App\Models\PaymentMethod;
use App\Models\Permission;
use App\Models\Product;
use App\Models\Role;
use App\Models\Setting;
use App\Models\TaxRate;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoDataSeeder;

class SeederTest extends DatabaseTestCase
{
    public function test_reference_data_seeds_and_is_idempotent(): void
    {
        $this->seed(DatabaseSeeder::class);
        $counts = [Role::count(), Permission::count(), TaxRate::count(), PaymentMethod::count(), Setting::count(), User::count()];

        $this->seed(DatabaseSeeder::class);

        $this->assertSame($counts, [Role::count(), Permission::count(), TaxRate::count(), PaymentMethod::count(), Setting::count(), User::count()]);
        $this->assertSame(count(Permissions::ALL), Permission::count());
        $this->assertSame('12.0000', TaxRate::where('code', 'VAT12')->value('rate'));
        $this->assertSame(0, Product::count(), 'demo data must not be seeded outside the local environment');
    }

    public function test_owner_has_every_permission_and_cashier_cannot_void(): void
    {
        $this->seed(DatabaseSeeder::class);

        $owner = User::where('username', config('compriva.seed.owner_username'))->firstOrFail();
        foreach (array_keys(Permissions::ALL) as $permission) {
            $this->assertTrue($owner->hasPermission($permission), $permission);
        }

        $cashier = User::factory()->create();
        $cashier->roles()->attach(Role::where('name', 'cashier')->value('id'));
        $this->assertTrue($cashier->hasPermission('pos.access'));
        $this->assertFalse($cashier->hasPermission('sales.void'));
    }

    public function test_demo_data_builds_a_consistent_store(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DemoDataSeeder::class);

        $this->assertSame(12, Product::count());
        // Opening stock: ledger and projection agree for every SKU.
        foreach (Product::with('skus.inventoryLevels', 'skus.stockMovements')->get()->pluck('skus')->flatten() as $sku) {
            $this->assertSame(
                (float) $sku->stockMovements->sum(fn ($m) => (float) $m->quantity), // an out-of-stock SKU has no movements
                (float) $sku->inventoryLevels->first()->quantity_on_hand,
                $sku->code,
            );
        }

        // Re-running is a no-op.
        $this->seed(DemoDataSeeder::class);
        $this->assertSame(12, Product::count());
    }
}
