<?php

namespace App\Http\Resources\V1\Sales;

use App\Domain\Sales\Pricing\FixedPoint;
use App\Models\Sale;
use App\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A sale with everything a receipt needs (when its relations are loaded).
 * Amounts are the snapshot stored at the time of sale, never recalculated.
 *
 * @mixin Sale
 */
class SaleResource extends JsonResource
{
    /** Relations a full sale view and receipt use. */
    public const RECEIPT_RELATIONS = ['device', 'cashier', 'voider', 'items.returnItems', 'discounts', 'payments', 'returns.refunds', 'returns.processor', 'store'];

    public static function receipt(Sale $sale): self
    {
        return new self($sale->load(self::RECEIPT_RELATIONS));
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'receipt_number' => $this->receipt_number,
            'status' => $this->status,
            'terminal' => $this->whenLoaded('device', fn () => ['id' => $this->device->id, 'code' => $this->device->code, 'name' => $this->device->name]),
            'cashier' => $this->whenLoaded('cashier', fn () => ['id' => $this->cashier->id, 'name' => $this->cashier->name]),
            'cashier_shift_id' => $this->cashier_shift_id,
            'occurred_at' => $this->occurred_at->toIso8601ZuluString(),
            'business_date' => $this->business_date->toDateString(),
            'customer_name' => $this->customer_name,
            'customer_id_number' => $this->customer_id_number,
            'gross_amount' => $this->gross_amount,
            'discount_total' => $this->discount_total,
            'vat_exemption' => $this->whenLoaded('items', fn () => FixedPoint::format($this->items->sum(
                fn ($item) => max(0, FixedPoint::cents($item->gross_amount) - FixedPoint::cents($item->discount_amount) - FixedPoint::cents($item->line_total)),
            ))),
            'vatable_sales' => $this->vatable_sales,
            'vat_amount' => $this->vat_amount,
            'vat_exempt_sales' => $this->vat_exempt_sales,
            'zero_rated_sales' => $this->zero_rated_sales,
            'grand_total' => $this->grand_total,
            'amount_paid' => $this->amount_paid,
            'change_due' => $this->change_due,
            'items_count' => $this->whenCounted('items'),
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn ($item) => [
                'id' => $item->id,
                'line_number' => $item->line_number,
                'sku_id' => $item->product_sku_id,
                'product_name' => $item->product_name,
                'sku_code' => $item->sku_code,
                'barcode' => $item->barcode,
                'unit_name' => $item->unit_name,
                'quantity' => $item->quantity,
                'regular_unit_price' => $item->regular_unit_price,
                'unit_price' => $item->unit_price,
                'price_overridden' => $item->price_override_by !== null,
                'gross_amount' => $item->gross_amount,
                'discount_amount' => $item->discount_amount,
                'tax_code' => $item->tax_code,
                'tax_type' => $item->tax_type,
                'tax_amount' => $item->tax_amount,
                'line_total' => $item->line_total,
                'returned_quantity' => $item->relationLoaded('returnItems')
                    ? $item->returnItems->reduce(fn ($carry, $r) => bcadd($carry, $r->quantity, 4), '0.0000')
                    : null,
            ])->values()),
            'discounts' => $this->whenLoaded('discounts', fn () => $this->discounts->map(fn ($d) => [
                'id' => $d->id,
                'sale_item_id' => $d->sale_item_id,
                'name' => $d->name,
                'kind' => $d->kind,
                'type' => $d->type,
                'value' => $d->value,
                'amount' => $d->amount,
                'customer_id_number' => $d->customer_id_number,
            ])->values()),
            'payments' => $this->whenLoaded('payments', fn () => $this->payments->map(fn ($p) => [
                'id' => $p->id,
                'method' => $p->method_code,
                'amount' => $p->amount,
                'tendered_amount' => $p->tendered_amount,
                'change_amount' => $p->change_amount,
                'reference_number' => $p->reference_number,
            ])->values()),
            'returns' => $this->whenLoaded('returns', fn () => $this->returns->map(fn ($r) => [
                'id' => $r->id,
                'return_number' => $r->return_number,
                'total_refund' => $r->total_refund,
                'reason' => $r->reason,
                'occurred_at' => $r->occurred_at->toIso8601ZuluString(),
                'processed_by' => $r->relationLoaded('processor') ? $r->processor?->name : null,
                'refunds' => $r->relationLoaded('refunds') ? $r->refunds->map(fn ($f) => ['method' => $f->method_code, 'amount' => $f->amount])->values() : [],
            ])->values()),
            'void' => $this->voided_at === null ? null : [
                'voided_at' => $this->voided_at->toIso8601ZuluString(),
                'voided_by' => $this->relationLoaded('voider') ? $this->voider?->name : null,
                'reason' => $this->void_reason,
            ],
            'store' => $this->whenLoaded('store', fn () => [
                'name' => $this->store->name,
                'legal_name' => $this->store->legal_name,
                'tin' => $this->store->tin,
                'address' => $this->store->address,
                'phone' => $this->store->phone,
                'is_vat_registered' => $this->store->is_vat_registered,
            ]),
            'receipt' => $this->whenLoaded('store', fn () => self::receiptSettings()),
            'notes' => $this->notes,
        ];
    }

    /** Receipt layout settings (global). @return array<string, mixed> */
    public static function receiptSettings(): array
    {
        $settings = Setting::whereNull('store_id')->where('group', 'receipt')->pluck('value', 'key');

        return [
            'header_lines' => $settings['header_lines'] ?? [],
            'footer_text' => $settings['footer_text'] ?? null,
            'show_vat_breakdown' => (bool) ($settings['show_vat_breakdown'] ?? true),
            'paper_size' => $settings['paper_size'] ?? '80mm',
        ];
    }
}
