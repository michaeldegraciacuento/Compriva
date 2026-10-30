<?php

namespace App\Domain\Purchasing\Actions;

use App\Domain\Purchasing\Enums\PurchaseOrderStatus;
use App\Domain\Sales\Pricing\FixedPoint;
use App\Models\ProductSku;
use App\Models\PurchaseOrder;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Purchase orders: draft → ordered → partially received → received, or
 * cancelled before anything arrives. Drafts can be edited; ordering needs
 * purchasing.approve. Amounts are computed here (integer centavos), never
 * taken from the client. Receiving is ReceiveGoods.
 */
class ManagePurchaseOrders
{
    private const SCALE = 4;

    public function __construct(private readonly AuditLogger $audit) {}

    /** @param array<string, mixed> $data validated PurchaseOrderRequest data */
    public function create(User $actor, array $data): PurchaseOrder
    {
        return DB::transaction(function () use ($actor, $data) {
            $order = PurchaseOrder::create([
                'store_id' => Store::query()->orderBy('created_at')->value('id'),
                'supplier_id' => $this->supplier($data['supplier_id'])->id,
                'po_number' => $this->nextNumber(),
                'status' => PurchaseOrderStatus::Draft,
                'order_date' => $data['order_date'] ?? now()->toDateString(),
                'expected_date' => $data['expected_date'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => $actor->id,
            ]);
            $this->writeItems($order, $data['items']);
            $this->audit->record('purchase_order.created', $order, new: ['number' => $order->po_number, 'total' => $order->total]);

            return $order;
        });
    }

    /** @param array<string, mixed> $data */
    public function update(PurchaseOrder $order, array $data): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $data) {
            $order = PurchaseOrder::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($order->status !== PurchaseOrderStatus::Draft) {
                throw new BusinessException("{$order->po_number} was already ordered; only drafts can be edited.", ErrorCode::Conflict, 409);
            }

            $order->update([
                'supplier_id' => $this->supplier($data['supplier_id'])->id,
                'order_date' => $data['order_date'] ?? $order->order_date,
                'expected_date' => $data['expected_date'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);
            $order->items()->delete();
            $this->writeItems($order, $data['items']);
            $this->audit->record('purchase_order.updated', $order, new: ['total' => $order->total]);

            return $order;
        });
    }

    /** Sends the order to the supplier: it can then be received, no longer edited. */
    public function approve(PurchaseOrder $order, User $actor): PurchaseOrder
    {
        return $this->transition($order, PurchaseOrderStatus::Draft, function (PurchaseOrder $order) use ($actor) {
            $order->forceFill(['status' => PurchaseOrderStatus::Ordered, 'approved_by' => $actor->id, 'ordered_at' => now()])->save();
            $this->audit->record('purchase_order.ordered', $order, new: ['number' => $order->po_number]);
        });
    }

    public function cancel(PurchaseOrder $order, ?string $reason): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $reason) {
            $order = PurchaseOrder::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (! in_array($order->status, [PurchaseOrderStatus::Draft, PurchaseOrderStatus::Ordered], true)) {
                throw new BusinessException("{$order->po_number} has deliveries and cannot be cancelled.", ErrorCode::Conflict, 409);
            }
            $order->forceFill([
                'status' => PurchaseOrderStatus::Cancelled,
                'cancelled_at' => now(),
                'notes' => trim(implode("\n", array_filter([$order->notes, $reason ? "Cancelled: {$reason}" : null]))) ?: null,
            ])->save();
            $this->audit->record('purchase_order.cancelled', $order, new: ['reason' => $reason]);

            return $order;
        });
    }

    private function transition(PurchaseOrder $order, PurchaseOrderStatus $from, callable $apply): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $from, $apply) {
            $order = PurchaseOrder::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($order->status !== $from) {
                throw new BusinessException("{$order->po_number} is {$order->status->value}.", ErrorCode::Conflict, 409);
            }
            $apply($order);

            return $order;
        });
    }

    /** @param list<array{sku_id: string, unit_id: string, quantity: string, unit_cost: string}> $items */
    private function writeItems(PurchaseOrder $order, array $items): void
    {
        $skus = ProductSku::with('unitConversions', 'product')->whereIn('id', array_column($items, 'sku_id'))->get()->keyBy('id');
        $subtotal = 0;

        foreach ($items as $i => $item) {
            $sku = $skus->get($item['sku_id']);
            if ($sku === null || ! $sku->product->track_inventory) {
                $this->invalid("items.{$i}.sku_id", 'This product is not stocked, so it cannot be ordered.');
            }
            $factor = $item['unit_id'] === $sku->base_unit_id ? '1' : $sku->unitConversions->firstWhere('unit_id', $item['unit_id'])?->factor;
            if ($factor === null) {
                $this->invalid("items.{$i}.unit_id", "{$sku->name} has no such unit. Add the unit to the product first.");
            }

            $lineTotal = FixedPoint::divRound(FixedPoint::parse((string) $item['quantity']) * FixedPoint::parse((string) $item['unit_cost']), FixedPoint::SCALE * 100);
            $subtotal += $lineTotal;

            $order->items()->create([
                'product_sku_id' => $sku->id,
                'unit_id' => $item['unit_id'],
                'conversion_factor' => $factor,
                'quantity_ordered' => bcadd((string) $item['quantity'], '0', self::SCALE),
                'unit_cost' => bcadd((string) $item['unit_cost'], '0', self::SCALE),
                'line_total' => FixedPoint::format($lineTotal),
            ]);
        }

        $order->forceFill(['subtotal' => FixedPoint::format($subtotal), 'total' => FixedPoint::format($subtotal)])->save();
    }

    private function supplier(string $id): Supplier
    {
        return Supplier::whereKey($id)->where('is_active', true)->first()
            ?? $this->invalid('supplier_id', 'Choose an active supplier.');
    }

    private function nextNumber(): string
    {
        $last = PurchaseOrder::where('po_number', 'like', 'PO-%')->orderByDesc('po_number')->lockForUpdate()->value('po_number');

        return sprintf('PO-%06d', $last === null ? 1 : (int) substr($last, 3) + 1);
    }

    private function invalid(string $field, string $message): never
    {
        throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => [$field => [$message]]]);
    }
}
