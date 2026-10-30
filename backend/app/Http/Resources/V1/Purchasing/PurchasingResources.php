<?php

namespace App\Http\Resources\V1\Purchasing;

use App\Models\GoodsReceipt;
use App\Models\PurchaseOrder;
use App\Models\Supplier;

/** Shapes for suppliers, purchase orders and goods receipts. */
final class PurchasingResources
{
    /** @return array<string, mixed> */
    public static function supplier(Supplier $supplier): array
    {
        return [
            'id' => $supplier->id,
            'code' => $supplier->code,
            'name' => $supplier->name,
            'contact_person' => $supplier->contact_person,
            'phone' => $supplier->phone,
            'email' => $supplier->email,
            'address' => $supplier->address,
            'tin' => $supplier->tin,
            'payment_terms_days' => $supplier->payment_terms_days,
            'notes' => $supplier->notes,
            'is_active' => $supplier->is_active,
            'open_orders_count' => $supplier->open_orders_count ?? null,
            'purchased_total' => $supplier->purchased_total !== null ? bcadd((string) $supplier->purchased_total, '0', 4) : null,
            'last_received_at' => $supplier->last_received_at ?? null,
        ];
    }

    /** @return array<string, mixed> */
    public static function order(PurchaseOrder $order, bool $full = false): array
    {
        $data = [
            'id' => $order->id,
            'number' => $order->po_number,
            'status' => $order->status,
            'supplier' => $order->relationLoaded('supplier') ? ['id' => $order->supplier->id, 'code' => $order->supplier->code, 'name' => $order->supplier->name] : null,
            'order_date' => $order->order_date->toDateString(),
            'expected_date' => $order->expected_date?->toDateString(),
            'total' => $order->total,
            'notes' => $order->notes,
            'created_by' => $order->relationLoaded('creator') ? $order->creator?->name : null,
            'approved_by' => $order->relationLoaded('approver') ? $order->approver?->name : null,
            'ordered_at' => $order->ordered_at?->toIso8601ZuluString(),
            'cancelled_at' => $order->cancelled_at?->toIso8601ZuluString(),
            'items_count' => $order->items_count ?? ($order->relationLoaded('items') ? $order->items->count() : null),
            'created_at' => $order->created_at?->toIso8601ZuluString(),
        ];

        if ($full) {
            $data['items'] = $order->items->map(fn ($item) => [
                'id' => $item->id,
                'sku' => ['id' => $item->sku->id, 'code' => $item->sku->code, 'name' => $item->sku->name,
                    'tracks' => ['batches' => $item->sku->product->track_batches, 'expiry' => $item->sku->product->track_expiry]],
                'unit' => ['id' => $item->unit->id, 'code' => $item->unit->code, 'name' => $item->unit->name, 'allows_decimal' => $item->unit->allows_decimal],
                'conversion_factor' => $item->conversion_factor,
                'quantity_ordered' => $item->quantity_ordered,
                'quantity_received' => $item->quantity_received,
                'quantity_remaining' => bcsub($item->quantity_ordered, $item->quantity_received, 4),
                'unit_cost' => $item->unit_cost,
                'line_total' => $item->line_total,
            ])->values();
            $data['receipts'] = $order->goodsReceipts->map(fn (GoodsReceipt $r) => self::receipt($r))->values();
        }

        return $data;
    }

    /** @return array<string, mixed> */
    public static function receipt(GoodsReceipt $receipt, bool $full = false): array
    {
        $data = [
            'id' => $receipt->id,
            'number' => $receipt->receipt_number,
            'status' => $receipt->status,
            'supplier' => $receipt->relationLoaded('supplier') ? ['id' => $receipt->supplier->id, 'name' => $receipt->supplier->name] : null,
            'purchase_order' => $receipt->relationLoaded('purchaseOrder') && $receipt->purchaseOrder
                ? ['id' => $receipt->purchaseOrder->id, 'number' => $receipt->purchaseOrder->po_number] : null,
            'supplier_reference' => $receipt->supplier_reference,
            'total_cost' => $receipt->total_cost,
            'notes' => $receipt->notes,
            'received_at' => $receipt->received_at->toIso8601ZuluString(),
            'received_by' => $receipt->relationLoaded('receiver') ? $receipt->receiver?->name : null,
        ];

        if ($full) {
            $data['items'] = $receipt->items->map(fn ($item) => [
                'id' => $item->id,
                'sku' => ['id' => $item->sku->id, 'code' => $item->sku->code, 'name' => $item->sku->name],
                'unit' => ['id' => $item->unit->id, 'code' => $item->unit->code, 'name' => $item->unit->name],
                'quantity' => $item->quantity,
                'base_quantity' => $item->base_quantity,
                'unit_cost' => $item->unit_cost,
                'line_total' => $item->line_total,
                'batch_number' => $item->batch_number,
                'expiry_date' => $item->expiry_date?->toDateString(),
            ])->values();
        }

        return $data;
    }
}
