<?php

namespace App\Domain\Sync\Queries;

use App\Domain\Catalog\Enums\PriceTier;
use App\Domain\Identity\Queries\TerminalCashiers;
use App\Domain\Sales\Enums\DiscountScope;
use App\Http\Resources\V1\Sales\PosResources;
use App\Http\Resources\V1\Sales\SaleResource;
use App\Models\Category;
use App\Models\Device;
use App\Models\Discount;
use App\Models\PaymentMethod;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\Setting;
use App\Models\Store;
use App\Models\TerminalStockAllocation;
use Illuminate\Database\Eloquent\Builder;

/**
 * What a terminal caches to sell offline: sellable items with barcodes,
 * categories, payment methods, discounts, cashiers (offline PIN sign-in),
 * settings, and its own stock allocations. Used by the POS bootstrap and by
 * the sync pull (snapshot and changes), so both describe data the same way.
 */
class TerminalData
{
    public function __construct(private readonly TerminalCashiers $cashiers) {}

    /**
     * Sellable items: the POS item shape plus barcodes. SKUs that cannot be
     * sold (inactive, deleted, no price) come back in `removed`.
     *
     * @param  ?list<string>  $skuIds  null = every SKU
     * @return array{items: list<array<string, mixed>>, removed: list<string>}
     */
    public function items(?array $skuIds = null): array
    {
        $skus = ProductSku::withTrashed()
            ->with(['product' => fn ($q) => $q->withTrashed()->with('taxRate', 'images'), 'baseUnit', 'unitConversions.unit', 'inventoryLevels', 'barcodes'])
            ->when($skuIds !== null, fn (Builder $q) => $q->whereKey($skuIds))
            ->get();

        $prices = ProductPrice::whereIn('product_sku_id', $skus->modelKeys())->where('tier', PriceTier::Retail)
            ->effectiveAt()->orderBy('effective_from')->get()
            ->groupBy('product_sku_id')
            ->map(fn ($rows) => $rows->pluck('price', 'unit_id')->all());

        $items = [];
        $removed = [];
        foreach ($skus as $sku) {
            $sellable = $sku->deleted_at === null && $sku->is_active && $sku->product->deleted_at === null && $sku->product->is_active;
            $item = $sellable ? PosResources::item($sku, $prices->get($sku->id, [])) : null;
            if ($item === null || count($item['units']) === 0) {
                $removed[] = $sku->id;

                continue;
            }
            $item['barcodes'] = $sku->barcodes->map(fn ($b) => ['barcode' => $b->barcode, 'unit_id' => $b->unit_id])->values()->all();
            $items[] = $item;
        }

        return ['items' => $items, 'removed' => $removed];
    }

    /** @return list<array{id: string, name: string}> */
    public function categories(): array
    {
        return Category::where('is_active', true)
            ->whereHas('products', fn (Builder $q) => $q->where('is_active', true))
            ->orderBy('name')->get(['id', 'name'])->toArray();
    }

    /** @return list<array<string, mixed>> */
    public function paymentMethods(): array
    {
        return PaymentMethod::where('is_active', true)->orderBy('sort_order')->get()->map(PosResources::paymentMethod(...))->all();
    }

    /** @return list<array<string, mixed>> */
    public function discounts(): array
    {
        return Discount::where('is_active', true)->where('scope', DiscountScope::Sale)
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', now()))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()))
            ->orderBy('name')->get()
            ->map(fn (Discount $d) => [
                'id' => $d->id, 'code' => $d->code, 'name' => $d->name, 'kind' => $d->kind, 'type' => $d->type, 'value' => $d->value,
                'is_vat_exempt' => $d->is_vat_exempt, 'requires_customer_id' => $d->requires_customer_id,
                'requires_approval' => $d->requires_approval, 'max_amount' => $d->max_discount_amount, 'min_purchase' => $d->min_purchase_amount,
            ])->all();
    }

    /** @return array<string, mixed> Cashiers allowed on the POS, with PIN hashes, and how long the list is valid offline. */
    public function cashiers(): array
    {
        return $this->cashiers->get();
    }

    /** Receipt layout, store header, POS rules. @return array<string, mixed> */
    public function settings(): array
    {
        $store = Store::query()->orderBy('created_at')->first();
        $pos = Setting::whereNull('store_id')->where('group', 'pos')->pluck('value', 'key');

        return [
            'receipt' => SaleResource::receiptSettings(),
            'store' => $store === null ? null : [
                'name' => $store->name, 'legal_name' => $store->legal_name, 'tin' => $store->tin, 'address' => $store->address,
                'phone' => $store->phone, 'is_vat_registered' => $store->is_vat_registered, 'timezone' => $store->timezone,
            ],
            'pos' => [
                'allow_over_allocation' => (bool) ($pos['allow_over_allocation'] ?? false),
                'max_offline_hours' => (int) config('compriva.sync.max_offline_hours'),
            ],
        ];
    }

    /**
     * What this terminal may still sell per SKU, as the server knows it
     * (allocated − consumed − released, base units).
     *
     * @param  ?list<string>  $allocationIds  null = all of the terminal's allocations
     * @return list<array{sku_id: string, remaining: string}>
     */
    public function allocations(Device $device, ?array $allocationIds = null): array
    {
        return TerminalStockAllocation::where('device_id', $device->id)
            ->when($allocationIds !== null, fn (Builder $q) => $q->whereKey($allocationIds))
            ->get()
            ->map(fn (TerminalStockAllocation $a) => ['sku_id' => $a->product_sku_id, 'remaining' => $a->availableQuantity()])
            ->all();
    }
}
