<?php

namespace Tests\Feature\Catalog;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\User;
use App\Support\Validation\BarcodeRule;
use Database\Seeders\ReferenceDataSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Auth\AuthTestCase;

class ProductCatalogTest extends AuthTestCase
{
    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReferenceDataSeeder::class);
        $this->manager = $this->userWithRole('manager');
    }

    private function unit(string $code): string
    {
        return Unit::where('code', $code)->value('id');
    }

    /** A valid EAN-13 in the restricted-circulation range. */
    private function ean(int $n): string
    {
        $body = sprintf('200%09d', $n);
        foreach (range(0, 9) as $check) {
            if (BarcodeRule::validCheckDigit($body.$check)) {
                return $body.$check;
            }
        }
    }

    private function createProduct(array $overrides = [], array $sku = []): array
    {
        return $this->actingAsUser($this->manager)->postJson('/api/v1/products', [
            'name' => 'Coca-Cola Regular',
            'tax_rate_id' => TaxRate::where('code', 'VAT12')->value('id'),
            'category_id' => Category::factory()->create()->id,
            'brand_id' => Brand::factory()->create()->id,
            'skus' => [[
                'variant' => '1.5L', 'base_unit_id' => $this->unit('pc'), 'cost_price' => '61.50',
                'price' => '75.00', 'barcode' => $this->ean(1), 'reorder_level' => '24', ...$sku,
            ]],
            ...$overrides,
        ])->assertCreated()->json('data');
    }

    public function test_creates_a_product_with_its_first_sku_barcode_unit_and_price(): void
    {
        $product = $this->createProduct();
        $sku = $product['skus'][0];

        $this->assertSame('Coca-Cola Regular 1.5L', $sku['name']);
        $this->assertSame('SKU-00001', $sku['code']);
        $this->assertSame('pc', $sku['base_unit']['code']);
        $this->assertSame($this->ean(1), $sku['barcodes'][0]['barcode']);
        $this->assertTrue($sku['barcodes'][0]['is_primary']);
        $this->assertTrue($sku['conversions'][0]['is_base']);
        $this->assertSame('1.000000', $sku['conversions'][0]['factor']);
        $this->assertSame('75.0000', $sku['prices'][0]['price']);
        $this->assertSame('0.0000', $sku['stock']['quantity_on_hand']);

        $this->getJson("/api/v1/products/{$product['id']}")->assertOk()->assertJsonPath('data.tax_rate.code', 'VAT12');
        $this->assertDatabaseHas('audit_logs', ['event' => 'product.created', 'auditable_id' => $product['id']]);
    }

    public function test_automatic_sku_codes_follow_the_highest_number_whatever_its_width(): void
    {
        // Demo/imported codes with 4 digits: as text "SKU-0012" sorts after "SKU-00013".
        $this->createProduct(['name' => 'Old A'], ['code' => 'SKU-0012', 'barcode' => null]);
        $this->createProduct(['name' => 'Old B'], ['code' => 'SKU-00013', 'barcode' => null]);

        $this->assertSame('SKU-00014', $this->createProduct(['name' => 'New'], ['barcode' => null])['skus'][0]['code']);
    }

    public function test_barcodes_are_validated_and_unique(): void
    {
        $this->createProduct();

        $this->actingAsUser($this->manager)->postJson('/api/v1/products', [
            'name' => 'Bad barcode', 'tax_rate_id' => TaxRate::where('code', 'VAT12')->value('id'),
            'skus' => [['base_unit_id' => $this->unit('pc'), 'price' => '1', 'barcode' => '2000000000010']],
        ])->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->assertSame(1, Product::count()); // nothing half-created

        $sku = ProductSku::first();
        $this->postJson("/api/v1/skus/{$sku->id}/barcodes", ['barcode' => $this->ean(1), 'type' => 'ean13'])
            ->assertUnprocessable()->assertJsonFragment(['This barcode is already assigned to another product.']);
        $this->postJson("/api/v1/skus/{$sku->id}/barcodes", ['barcode' => 'INT-0001', 'type' => 'internal'])->assertCreated();
    }

    public function test_unit_conversions_barcodes_and_prices_per_unit(): void
    {
        $sku = $this->createProduct()['skus'][0];
        $case = $this->unit('case');

        $this->postJson("/api/v1/skus/{$sku['id']}/conversions", ['unit_id' => $case, 'factor' => '12'])
            ->assertCreated()->assertJsonPath('data.conversions.1.unit.code', 'case')->assertJsonPath('data.conversions.1.factor', '12.000000');
        $this->postJson("/api/v1/skus/{$sku['id']}/barcodes", ['barcode' => $this->ean(2), 'type' => 'ean13', 'unit_id' => $case])
            ->assertCreated()->assertJsonPath('data.barcodes.1.unit.code', 'case');
        $this->postJson("/api/v1/skus/{$sku['id']}/prices", ['unit_id' => $case, 'price' => '870'])->assertCreated();

        // A unit in use cannot be removed; the base unit's factor is fixed.
        $caseConversion = collect($this->getJson("/api/v1/products/{$sku['product_id']}")->json('data.skus.0.conversions'))->firstWhere('unit.code', 'case');
        $baseConversion = collect($this->getJson("/api/v1/products/{$sku['product_id']}")->json('data.skus.0.conversions'))->firstWhere('is_base', true);
        $this->assertErrorCode($this->deleteJson("/api/v1/conversions/{$caseConversion['id']}"), 409, 'CONFLICT');
        $this->assertErrorCode($this->patchJson("/api/v1/conversions/{$baseConversion['id']}", ['factor' => '2']), 409, 'BUSINESS_RULE_VIOLATION');

        // Prices only for units the SKU has.
        $this->postJson("/api/v1/skus/{$sku['id']}/prices", ['unit_id' => $this->unit('kg'), 'price' => '1'])->assertUnprocessable();
    }

    public function test_price_changes_keep_history(): void
    {
        $sku = $this->createProduct()['skus'][0];
        $pc = $this->unit('pc');

        // Prices are stored to the second; a change in the same second as the previous
        // price starts one second later (covered below). People change prices slower than that.
        $this->travel(2)->seconds();
        $this->postJson("/api/v1/skus/{$sku['id']}/prices", ['unit_id' => $pc, 'price' => '79.00'])->assertCreated();
        $this->postJson("/api/v1/skus/{$sku['id']}/prices", ['unit_id' => $pc, 'price' => '82.00', 'effective_from' => now()->addWeek()->toIso8601String()])->assertCreated();

        $history = $this->getJson("/api/v1/skus/{$sku['id']}/prices")->assertOk()->json('data');
        $this->assertSame(['82.0000', '79.0000', '75.0000'], array_column($history, 'price'));
        $this->assertNotNull($history[2]['effective_to']); // the original price was closed, not overwritten
        $this->assertSame('79.0000', $this->getJson("/api/v1/products/{$sku['product_id']}")->json('data.skus.0.prices.0.price'));

        $this->assertErrorCode(
            $this->postJson("/api/v1/skus/{$sku['id']}/prices", ['unit_id' => $pc, 'price' => '80.00']),
            409, 'CONFLICT',
        ); // a later price is already scheduled
        $this->assertSame(3, ProductPrice::where('product_sku_id', $sku['id'])->count());
    }

    public function test_two_immediate_price_changes_in_the_same_second_stay_ordered(): void
    {
        $sku = $this->createProduct()['skus'][0];
        $this->freezeSecond();

        $this->postJson("/api/v1/skus/{$sku['id']}/prices", ['unit_id' => $this->unit('pc'), 'price' => '79.00'])->assertCreated();

        $history = ProductPrice::where('product_sku_id', $sku['id'])->orderBy('effective_from')->get();
        $this->assertSame(['75.0000', '79.0000'], $history->pluck('price')->all());
        $this->assertTrue($history[1]->effective_from->gt($history[0]->effective_from));
        $this->assertTrue($history[0]->effective_to->eq($history[1]->effective_from)); // no gap, no overlap
    }

    public function test_activation_and_base_unit_lock(): void
    {
        $product = $this->createProduct();
        $sku = $product['skus'][0];

        $this->postJson("/api/v1/products/{$product['id']}/deactivate")->assertOk()->assertJsonPath('data.is_active', false);
        $this->getJson('/api/v1/products?status=inactive')->assertJsonCount(1, 'data');
        $this->postJson("/api/v1/products/{$product['id']}/activate")->assertOk()->assertJsonPath('data.is_active', true);
        $this->postJson("/api/v1/skus/{$sku['id']}/deactivate")->assertOk()->assertJsonPath('data.is_active', false);

        $this->patchJson("/api/v1/skus/{$sku['id']}", ['base_unit_id' => $this->unit('bottle')])->assertOk()->assertJsonPath('data.base_unit.code', 'bottle');

        $this->postJson('/api/v1/inventory/stock-in', [
            'reason' => 'received', 'lines' => [['product_sku_id' => $sku['id'], 'quantity' => '6', 'unit_cost' => '60']],
        ])->assertCreated();
        $this->assertErrorCode($this->patchJson("/api/v1/skus/{$sku['id']}", ['base_unit_id' => $this->unit('pc')]), 409, 'BUSINESS_RULE_VIOLATION');
    }

    public function test_product_list_search_and_sku_picker(): void
    {
        $product = $this->createProduct();
        $this->createProduct(['name' => 'Datu Puti Vinegar'], ['variant' => '1L', 'barcode' => $this->ean(5)]);

        $this->getJson('/api/v1/products?q=vinegar')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Datu Puti Vinegar');
        $this->getJson('/api/v1/products?q='.$this->ean(1))->assertJsonPath('data.0.id', $product['id']);
        $this->getJson('/api/v1/skus/search?q='.$this->ean(5))->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.product_name', 'Datu Puti Vinegar')
            ->assertJsonPath('data.0.tracks', ['batches' => false, 'expiry' => false])
            ->assertJsonStructure(['data' => [['conversions', 'stock', 'base_unit']]]);
    }

    /**
     * A real PNG (solid gray, size x size) built without GD, which XAMPP PHP lacks.
     * The application itself only needs getimagesize(), which works without GD.
     */
    private function png(string $name, int $size): UploadedFile
    {
        $chunk = fn (string $type, string $data) => pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
        $rows = str_repeat(chr(0).str_repeat(chr(0x99), $size), $size); // filter byte + grayscale pixels
        $bytes = chr(0x89).'PNG'.chr(13).chr(10).chr(26).chr(10)
            .$chunk('IHDR', pack('NNCCCCC', $size, $size, 8, 0, 0, 0, 0))
            .$chunk('IDAT', gzcompress($rows))
            .$chunk('IEND', '');

        return UploadedFile::fake()->createWithContent($name, $bytes);
    }

    public function test_product_images_upload_serve_and_delete(): void
    {
        Storage::fake('local');
        $product = $this->createProduct();

        $first = $this->postJson("/api/v1/products/{$product['id']}/images", ['image' => $this->png('front.png', 600)])
            ->assertCreated()->json('data.images.0');
        $this->assertTrue($first['is_primary']);
        $second = $this->postJson("/api/v1/products/{$product['id']}/images", ['image' => $this->png('back.png', 400)])
            ->assertCreated()->json('data.images.1');

        $this->postJson("/api/v1/product-images/{$second['id']}/primary")->assertOk()->assertJsonPath('data.images.0.id', $second['id']);

        $this->resetAuth();
        $this->get($first['url'])->assertOk()->assertHeader('Content-Type', 'image/png'); // public, for <img> tags

        $path = ProductImage::find($first['id'])->path;
        $this->actingAsUser($this->manager)->deleteJson("/api/v1/product-images/{$first['id']}")->assertNoContent();
        Storage::disk('local')->assertMissing($path);

        $this->postJson("/api/v1/products/{$product['id']}/images", ['image' => UploadedFile::fake()->create('notes.pdf', 10, 'application/pdf')])
            ->assertUnprocessable();
    }

    public function test_categories_brands_and_units(): void
    {
        $this->actingAsUser($this->manager);
        $food = $this->postJson('/api/v1/categories', ['name' => 'Food'])->assertCreated()->json('data');
        $snacks = $this->postJson('/api/v1/categories', ['name' => 'Snacks', 'parent_id' => $food['id']])->assertCreated()->json('data');
        $this->assertSame('snacks', $snacks['slug']);

        $this->patchJson("/api/v1/categories/{$food['id']}", ['parent_id' => $snacks['id']])
            ->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['fields' => ['parent_id']]]]);
        $this->assertErrorCode($this->deleteJson("/api/v1/categories/{$food['id']}"), 409, 'CONFLICT'); // has a child
        $this->deleteJson("/api/v1/categories/{$snacks['id']}")->assertNoContent();

        $brand = $this->postJson('/api/v1/brands', ['name' => 'Nestlé'])->assertCreated()->json('data');
        $this->postJson('/api/v1/brands', ['name' => 'Nestlé'])->assertUnprocessable();
        $this->patchJson("/api/v1/brands/{$brand['id']}", ['name' => 'Nestle PH'])->assertOk()->assertJsonPath('data.slug', 'nestle-ph');

        $this->postJson('/api/v1/units', ['code' => 'sachet', 'name' => 'Sachet', 'type' => 'count'])->assertCreated();
        $this->postJson('/api/v1/units', ['code' => 'kg', 'name' => 'Kilo', 'type' => 'weight'])->assertUnprocessable();
        $codes = array_column($this->getJson('/api/v1/units')->json('data'), 'code');
        foreach (['pc', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'bottle', 'tray', 'dozen'] as $grocery) {
            $this->assertContains($grocery, $codes);
        }
    }

    public function test_permissions(): void
    {
        $product = $this->createProduct();
        $clerk = $this->userWithRole('inventory_clerk');

        $this->actingAsUser($clerk)->getJson('/api/v1/products')->assertOk(); // products.view
        $this->assertErrorCode($this->actingAsUser($clerk)->postJson("/api/v1/products/{$product['id']}/deactivate"), 403, 'FORBIDDEN');
        $this->assertErrorCode(
            $this->actingAsUser($clerk)->postJson("/api/v1/skus/{$product['skus'][0]['id']}/prices", ['unit_id' => $this->unit('pc'), 'price' => '1']),
            403, 'FORBIDDEN',
        );
        $this->assertErrorCode($this->actingAsUser($this->userWithRole('cashier'))->getJson('/api/v1/products'), 403, 'FORBIDDEN');
    }
}
