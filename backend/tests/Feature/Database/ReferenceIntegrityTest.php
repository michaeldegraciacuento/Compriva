<?php

namespace Tests\Feature\Database;

use App\Models\AuditLog;
use App\Models\Device;
use App\Models\ProductBarcode;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\Setting;
use App\Models\Store;
use App\Models\SyncOperation;
use App\Models\TaxRate;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Catalog, tax, settings, sync and audit constraints. */
class ReferenceIntegrityTest extends DatabaseTestCase
{
    public function test_tax_rates_are_percentages_between_0_and_100(): void
    {
        $this->assertCheckFails(fn () => TaxRate::factory()->create(['rate' => '112.0000']), 'tax_rates_rate_check');
        $this->assertCheckFails(fn () => TaxRate::factory()->create(['rate' => '-1.0000']), 'tax_rates_rate_check');
    }

    public function test_prices_cannot_be_negative_and_history_is_kept(): void
    {
        $price = ProductPrice::factory()->create(['price' => '50.0000', 'effective_from' => now()->subWeek()]);

        $this->assertCheckFails(fn () => ProductPrice::factory()->create(['price' => '-1.0000']), 'product_prices_price_check');

        // A price change closes the current row and adds a new one.
        $price->update(['effective_to' => now()]);
        ProductPrice::factory()->create([
            'product_sku_id' => $price->product_sku_id, 'unit_id' => $price->unit_id, 'price' => '55.0000', 'effective_from' => now(),
        ]);

        $this->assertSame(2, ProductPrice::where('product_sku_id', $price->product_sku_id)->count());
        $this->assertSame('55.0000', ProductPrice::where('product_sku_id', $price->product_sku_id)->effectiveAt(now()->addMinute())->value('price'));
        $this->assertSame('50.0000', ProductPrice::where('product_sku_id', $price->product_sku_id)->effectiveAt(now()->subDay())->value('price'));
    }

    public function test_barcodes_are_globally_unique(): void
    {
        $barcode = ProductBarcode::factory()->create();

        $this->assertDatabaseRejects(fn () => ProductBarcode::factory()->create(['barcode' => $barcode->barcode]), [self::CONSTRAINT]);
    }

    public function test_deleting_a_sku_row_removes_its_barcodes_and_conversions_only(): void
    {
        $sku = ProductSku::factory()->create();
        ProductBarcode::factory()->create(['product_sku_id' => $sku->id]);
        $sku->unitConversions()->create(['unit_id' => $sku->base_unit_id, 'factor' => '1']);

        $sku->forceDelete();

        $this->assertDatabaseCount('product_barcodes', 0);
        $this->assertDatabaseCount('unit_conversions', 0);
    }

    public function test_terminal_codes_are_unique_per_store_and_install_ids_globally(): void
    {
        $device = Device::factory()->active()->create();

        $this->assertDatabaseRejects(fn () => Device::factory()->create(['store_id' => $device->store_id, 'code' => $device->code]), [self::CONSTRAINT]);
        $this->assertDatabaseRejects(fn () => Device::factory()->active()->create(['install_id' => $device->install_id]), [self::CONSTRAINT]);

        // Same code in another store is fine.
        Device::factory()->create(['store_id' => Store::factory(), 'code' => $device->code]);
        $this->assertDatabaseCount('devices', 2);
    }

    public function test_devices_with_history_cannot_be_deleted(): void
    {
        $device = Device::factory()->active()->create();
        DB::table('sync_operations')->insert([
            'id' => (string) Str::uuid7(), 'device_id' => $device->id, 'local_seq' => 1, 'type' => 'sale.completed',
            'payload' => '{}', 'status' => 'applied', 'occurred_at' => now(), 'received_at' => now(),
        ]);

        $this->assertDatabaseRejects(fn () => $device->delete(), [self::CONSTRAINT]);
    }

    public function test_sync_operations_are_idempotent_by_id_and_ordered_per_device(): void
    {
        $device = Device::factory()->active()->create();
        $operation = [
            'id' => (string) Str::uuid7(), 'device_id' => $device->id, 'local_seq' => 1, 'type' => 'sale.completed',
            'payload' => ['sale_id' => (string) Str::uuid7()], 'status' => 'applied', 'occurred_at' => now(), 'received_at' => now(),
        ];
        SyncOperation::create($operation);

        // Same operation pushed again → primary key violation (the sync engine answers "duplicate").
        $this->assertDatabaseRejects(fn () => SyncOperation::create([...$operation, 'local_seq' => 2]), [self::CONSTRAINT]);
        // Two different operations cannot claim the same outbox position.
        $this->assertDatabaseRejects(fn () => SyncOperation::create([...$operation, 'id' => (string) Str::uuid7()]), [self::CONSTRAINT]);
    }

    public function test_settings_are_unique_per_scope_including_global(): void
    {
        $store = Store::factory()->create();
        Setting::create(['group' => 'receipt', 'key' => 'paper_size', 'value' => '80mm']);
        Setting::create(['store_id' => $store->id, 'group' => 'receipt', 'key' => 'paper_size', 'value' => '58mm']);

        $this->assertDatabaseRejects(fn () => Setting::create(['group' => 'receipt', 'key' => 'paper_size', 'value' => 'a4']), [self::CONSTRAINT]);
        $this->assertSame('58mm', Setting::where('store_id', $store->id)->value('value'));
    }

    public function test_audit_logs_are_append_only(): void
    {
        $log = AuditLog::create(['user_id' => User::factory()->create()->id, 'event' => 'sale.voided', 'created_at' => now()]);

        $this->assertDatabaseRejects(fn () => DB::table('audit_logs')->where('id', $log->id)->update(['event' => 'x']), [self::TRIGGER]);
        $this->assertDatabaseRejects(fn () => DB::table('audit_logs')->where('id', $log->id)->delete(), [self::TRIGGER]);
    }

    public function test_polymorphic_columns_store_aliases_not_class_names(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('terminal');
        $device = Device::factory()->active()->create();
        $device->createToken('device');

        $this->assertSame(['device', 'user'], DB::table('personal_access_tokens')->orderBy('tokenable_type')->pluck('tokenable_type')->all());
        $this->assertNotEmpty($token->plainTextToken);
    }
}
