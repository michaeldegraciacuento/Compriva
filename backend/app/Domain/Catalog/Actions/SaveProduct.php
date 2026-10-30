<?php

namespace App\Domain\Catalog\Actions;

use App\Models\Product;
use App\Models\ProductSku;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Products and their SKUs. A new SKU always gets its base-unit conversion
 * (factor 1), an optional barcode and its first retail price, in the same
 * transaction. Products and SKUs are deactivated, never deleted: sales and
 * stock history keep referencing them.
 */
class SaveProduct
{
    public function __construct(
        private readonly ManageBarcodes $barcodes,
        private readonly SetProductPrice $prices,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  product fields + skus[]
     */
    public function create(User $actor, array $data): Product
    {
        return DB::transaction(function () use ($actor, $data) {
            $product = Product::create($this->productFields($data));

            foreach ($data['skus'] as $sku) {
                $this->addSku($actor, $product, $sku);
            }

            $this->audit->record('product.created', $product, new: ['name' => $product->name, 'skus' => count($data['skus'])]);

            return $product;
        });
    }

    /** @param  array<string, mixed>  $data */
    public function update(Product $product, array $data): Product
    {
        $fields = $this->productFields($data, partial: true);
        $before = $product->only(array_keys($fields));
        $product->update($fields);
        $this->audit->record('product.updated', $product, $before, $fields);

        return $product;
    }

    public function setActive(Product $product, bool $active): Product
    {
        $product->update(['is_active' => $active]);
        $this->audit->record($active ? 'product.activated' : 'product.deactivated', $product);

        return $product;
    }

    /** @param  array<string, mixed>  $sku */
    public function addSku(User $actor, Product $product, array $sku): ProductSku
    {
        return DB::transaction(function () use ($actor, $product, $sku) {
            $variant = $sku['variant'] ?? null;
            $model = $product->skus()->create([
                'code' => filled($sku['code'] ?? null) ? strtoupper($sku['code']) : $this->nextCode(),
                'name' => filled($sku['name'] ?? null) ? $sku['name'] : trim($product->name.' '.$variant),
                'variant' => $variant,
                'base_unit_id' => $sku['base_unit_id'],
                'cost_price' => $sku['cost_price'] ?? '0',
                'reorder_level' => $sku['reorder_level'] ?? '0',
                'reorder_quantity' => $sku['reorder_quantity'] ?? '0',
                'is_active' => $sku['is_active'] ?? true,
            ]);

            $model->unitConversions()->create(['unit_id' => $model->base_unit_id, 'factor' => '1', 'is_purchase_unit' => true, 'is_sales_unit' => true]);

            if (filled($sku['barcode'] ?? null)) {
                $this->barcodes->add($model, ['barcode' => $sku['barcode'], 'type' => $sku['barcode_type'] ?? 'ean13', 'unit_id' => null]);
            }

            if (isset($sku['price'])) {
                $this->prices->set($actor, $model, ['unit_id' => $model->base_unit_id, 'tier' => 'retail', 'price' => $sku['price']]);
            }

            return $model;
        });
    }

    /** @param  array<string, mixed>  $data */
    public function updateSku(ProductSku $sku, array $data): ProductSku
    {
        if (isset($data['base_unit_id']) && $data['base_unit_id'] !== $sku->base_unit_id && $sku->stockMovements()->exists()) {
            throw new BusinessException('The base unit cannot change once the SKU has stock history.', ErrorCode::BusinessRuleViolation, 409, ['reason' => 'base_unit_locked']);
        }

        return DB::transaction(function () use ($sku, $data) {
            $before = $sku->only(array_keys($data));
            $oldBaseUnitId = $sku->base_unit_id;
            if (isset($data['code'])) {
                $data['code'] = strtoupper($data['code']);
            }
            $sku->update($data);

            if ($sku->base_unit_id !== $oldBaseUnitId) {
                // The base unit's own conversion (factor 1) follows the base unit.
                $sku->unitConversions()->where('unit_id', $oldBaseUnitId)->delete();
                $sku->unitConversions()->updateOrCreate(['unit_id' => $sku->base_unit_id], ['factor' => '1', 'is_purchase_unit' => true, 'is_sales_unit' => true]);
            }

            $this->audit->record('product_sku.updated', $sku, $before, $data);

            return $sku;
        });
    }

    public function setSkuActive(ProductSku $sku, bool $active): ProductSku
    {
        $sku->update(['is_active' => $active]);
        $this->audit->record($active ? 'product_sku.activated' : 'product_sku.deactivated', $sku);

        return $sku;
    }

    /** @return array<string, mixed> */
    private function productFields(array $data, bool $partial = false): array
    {
        $keys = ['name', 'description', 'category_id', 'brand_id', 'tax_rate_id', 'track_inventory', 'track_batches', 'track_expiry', 'is_active'];

        return $partial ? array_intersect_key($data, array_flip($keys)) : array_intersect_key($data, array_flip($keys)) + ['is_active' => true];
    }

    /**
     * SKU-00001, SKU-00002, … (locked so concurrent creates do not collide).
     * Compared as numbers, not text: imported or demo codes may use fewer
     * digits ("SKU-0012" sorts after "SKU-00013" as a string).
     */
    private function nextCode(): string
    {
        $highest = ProductSku::withTrashed()->where('code', 'like', 'SKU-%')->lockForUpdate()->pluck('code')
            ->map(fn (string $code) => preg_match('/^SKU-(\d+)$/', $code, $m) ? (int) $m[1] : 0)
            ->max() ?? 0;

        return sprintf('SKU-%05d', $highest + 1);
    }
}
