<?php

namespace App\Http\Resources\V1\Sales;

use App\Domain\Sales\Services\CartPricer;
use App\Models\CashierShift;
use App\Models\Device;
use App\Models\PaymentMethod;
use App\Models\ProductSku;
use App\Models\SaleReturn;

/** Shapes for the POS endpoints: terminal, shift, payment method, sellable item, return. */
final class PosResources
{
    /** @return array<string, mixed>|null */
    public static function terminal(?Device $device): ?array
    {
        return $device ? ['id' => $device->id, 'code' => $device->code, 'name' => $device->name, 'status' => $device->status] : null;
    }

    /**
     * @param  ?array<string, mixed>  $summary
     * @return array<string, mixed>|null
     */
    public static function shift(?CashierShift $shift, ?array $summary = null): ?array
    {
        if ($shift === null) {
            return null;
        }
        $shift->loadMissing('cashier', 'device', 'closer', 'cashMovements.performer');

        return [
            'id' => $shift->id,
            'status' => $shift->status,
            'terminal' => self::terminal($shift->device),
            'cashier' => ['id' => $shift->cashier->id, 'name' => $shift->cashier->name],
            'opening_float' => $shift->opening_float,
            'expected_cash' => $shift->expected_cash,
            'counted_cash' => $shift->counted_cash,
            'cash_variance' => $shift->cash_variance,
            'opened_at' => $shift->opened_at->toIso8601ZuluString(),
            'closed_at' => $shift->closed_at?->toIso8601ZuluString(),
            'closed_by' => $shift->closer?->name,
            'notes' => $shift->notes,
            'cash_movements' => $shift->cashMovements->sortBy('occurred_at')->map(fn ($m) => [
                'id' => $m->id,
                'type' => $m->type,
                'amount' => $m->amount,
                'reason' => $m->reason,
                'performed_by' => $m->performer?->name,
                'occurred_at' => $m->occurred_at->toIso8601ZuluString(),
            ])->values(),
            'summary' => $summary,
        ];
    }

    /** @return array<string, mixed> */
    public static function paymentMethod(PaymentMethod $method): array
    {
        return [
            'id' => $method->id,
            'code' => $method->code,
            'name' => $method->name,
            'type' => $method->type,
            'requires_reference' => $method->requires_reference,
            'allows_change' => $method->allows_change,
            'is_active' => $method->is_active,
            'account_name' => $method->account_name,
            'account_number' => $method->account_number,
            'qr_url' => $method->qr_image_path === null ? null
                : route('api.v1.media.payment-qr', ['method' => $method->id, 'v' => substr(md5($method->qr_image_path), 0, 8)]),
        ];
    }

    /**
     * A sellable SKU for the POS: units with their current retail price, tax
     * and stock. `matched_unit_id` is set when a scanned barcode belongs to a
     * pack unit (e.g. the barcode on a box of 24).
     *
     * @param  array<string, string>  $prices  unit_id => current retail price
     * @return array<string, mixed>
     */
    public static function item(ProductSku $sku, array $prices, ?string $matchedUnitId = null): array
    {
        $product = $sku->product;
        $level = $sku->inventoryLevels->first();
        $image = $product->images->firstWhere('is_primary', true) ?? $product->images->first();
        $base = $prices[$sku->base_unit_id] ?? null;

        $units = $sku->unitConversions->sortBy('factor')
            ->filter(fn ($c) => $c->unit_id === $sku->base_unit_id || $c->is_sales_unit || isset($prices[$c->unit_id]))
            ->map(fn ($c) => [
                'unit' => ['id' => $c->unit->id, 'code' => $c->unit->code, 'name' => $c->unit->name, 'allows_decimal' => $c->unit->allows_decimal],
                'factor' => $c->factor,
                'price' => $prices[$c->unit_id] ?? ($base === null ? null : CartPricer::packPrice($base, $c->factor)),
            ])
            ->filter(fn ($u) => $u['price'] !== null)
            ->values();

        if ($units->isEmpty() && $base !== null) {
            $units = collect([['unit' => ['id' => $sku->baseUnit->id, 'code' => $sku->baseUnit->code, 'name' => $sku->baseUnit->name, 'allows_decimal' => $sku->baseUnit->allows_decimal], 'factor' => '1.000000', 'price' => $base]]);
        }

        return [
            'id' => $sku->id,
            'product_id' => $product->id,
            'name' => $sku->name,
            'code' => $sku->code,
            'category_id' => $product->category_id,
            'image_url' => $image?->url(),
            'base_unit_id' => $sku->base_unit_id,
            'units' => $units,
            'matched_unit_id' => $matchedUnitId,
            'tax' => [
                'id' => $product->taxRate->id,
                'code' => $product->taxRate->code,
                'type' => $product->taxRate->type,
                'rate' => $product->taxRate->rate,
                'inclusive' => (bool) $product->taxRate->is_inclusive,
            ],
            'stock' => [
                'tracked' => (bool) $product->track_inventory,
                'on_hand' => $level?->quantity_on_hand ?? '0.0000',
                'available' => $level === null ? '0.0000' : bcsub($level->quantity_on_hand, $level->quantity_allocated, 4),
            ],
        ];
    }

    /** @return array<string, mixed> */
    public static function saleReturn(SaleReturn $return): array
    {
        $return->loadMissing('items.saleItem', 'refunds', 'sale', 'processor');

        return [
            'id' => $return->id,
            'return_number' => $return->return_number,
            'sale_id' => $return->sale_id,
            'receipt_number' => $return->sale->receipt_number,
            'reason' => $return->reason,
            'total_refund' => $return->total_refund,
            'vat_amount' => $return->vat_amount,
            'occurred_at' => $return->occurred_at->toIso8601ZuluString(),
            'processed_by' => $return->processor?->name,
            'items' => $return->items->map(fn ($item) => [
                'id' => $item->id,
                'sale_item_id' => $item->sale_item_id,
                'product_name' => $item->saleItem->product_name,
                'unit_name' => $item->saleItem->unit_name,
                'quantity' => $item->quantity,
                'refund_amount' => $item->refund_amount,
                'condition' => $item->condition,
                'restock' => $item->restock,
            ])->values(),
            'refunds' => $return->refunds->map(fn ($r) => ['method' => $r->method_code, 'amount' => $r->amount, 'reference_number' => $r->reference_number])->values(),
        ];
    }
}
