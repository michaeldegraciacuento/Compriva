<?php

namespace App\Domain\Purchasing\Actions;

use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Inventory\Services\StockLedger;
use App\Domain\Purchasing\Enums\PurchaseOrderStatus;
use App\Domain\Sales\Pricing\FixedPoint;
use App\Models\GoodsReceipt;
use App\Models\PurchaseOrder;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Receiving a delivery against a purchase order. Partial deliveries are
 * normal: each delivery is one goods receipt (GR-000001), the order tracks
 * what arrived, and it becomes "received" when every line is complete.
 *
 * The receipt is posted through the StockLedger in the same transaction:
 * stock, batches, weighted average cost and the SKU's latest cost change
 * together, or not at all. The actual cost per line may differ from the order
 * (cost tracking keeps both).
 */
class ReceiveGoods
{
    private const SCALE = 4;

    public function __construct(
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    /** @param array<string, mixed> $data validated ReceiveGoodsRequest data */
    public function execute(PurchaseOrder $order, User $actor, array $data): GoodsReceipt
    {
        return DB::transaction(function () use ($order, $actor, $data) {
            $order = PurchaseOrder::whereKey($order->id)->lockForUpdate()->with('items.sku.product', 'items.unit')->firstOrFail();
            if (! in_array($order->status, [PurchaseOrderStatus::Ordered, PurchaseOrderStatus::PartiallyReceived], true)) {
                throw new BusinessException(
                    $order->status === PurchaseOrderStatus::Draft ? "{$order->po_number} has not been ordered yet." : "{$order->po_number} is {$order->status->value}.",
                    ErrorCode::Conflict, 409,
                );
            }

            $items = $order->items->keyBy('id');
            $receipt = GoodsReceipt::create([
                'store_id' => $order->store_id,
                'supplier_id' => $order->supplier_id,
                'purchase_order_id' => $order->id,
                'receipt_number' => $this->nextNumber(),
                'supplier_reference' => $data['supplier_reference'] ?? null,
                'status' => DocumentStatus::Draft,
                'notes' => $data['notes'] ?? null,
                'received_at' => now(),
                'received_by' => $actor->id,
            ]);

            $total = 0;
            foreach ($data['lines'] as $i => $line) {
                $item = $items->get($line['purchase_order_item_id']) ?? $this->invalid("lines.{$i}.purchase_order_item_id", 'This line is not on the order.');
                $sku = $item->sku;
                $quantity = bcadd((string) $line['quantity'], '0', self::SCALE);
                $left = bcsub($item->quantity_ordered, $item->quantity_received, self::SCALE);

                if (bccomp($quantity, $left, self::SCALE) > 0) {
                    $this->invalid("lines.{$i}.quantity", "Only {$this->trim($left)} {$item->unit->name} of {$sku->name} are still expected. Receive extra goods with a stock-in.");
                }
                if (! $item->unit->allows_decimal && bccomp($quantity, (string) (int) $quantity, self::SCALE) !== 0) {
                    $this->invalid("lines.{$i}.quantity", "{$item->unit->name} must be a whole number.");
                }
                if ($sku->product->track_batches && blank($line['batch_number'] ?? null)) {
                    $this->invalid("lines.{$i}.batch_number", "{$sku->name} is tracked by batch: enter the batch number.");
                }
                if ($sku->product->track_expiry && blank($line['expiry_date'] ?? null)) {
                    $this->invalid("lines.{$i}.expiry_date", "{$sku->name} is tracked by expiry: enter the expiry date.");
                }

                $cost = bcadd((string) ($line['unit_cost'] ?? $item->unit_cost), '0', self::SCALE);
                $lineTotal = FixedPoint::divRound(FixedPoint::parse($quantity) * FixedPoint::parse($cost), FixedPoint::SCALE * 100);
                $total += $lineTotal;

                $receipt->items()->create([
                    'purchase_order_item_id' => $item->id,
                    'product_sku_id' => $sku->id,
                    'unit_id' => $item->unit_id,
                    'conversion_factor' => $item->conversion_factor,
                    'quantity' => $quantity,
                    'base_quantity' => bcmul($quantity, $item->conversion_factor, self::SCALE),
                    'unit_cost' => $cost,
                    'line_total' => FixedPoint::format($lineTotal),
                    'batch_number' => $line['batch_number'] ?? null,
                    'expiry_date' => $line['expiry_date'] ?? null,
                ]);
                $item->forceFill(['quantity_received' => bcadd($item->quantity_received, $quantity, self::SCALE)])->save();
            }

            $receipt->forceFill(['total_cost' => FixedPoint::format($total)])->save();
            $this->ledger->receive($receipt, $actor);

            $complete = $order->items->every(fn ($item) => bccomp($item->quantity_received, $item->quantity_ordered, self::SCALE) >= 0);
            $order->forceFill(['status' => $complete ? PurchaseOrderStatus::Received : PurchaseOrderStatus::PartiallyReceived])->save();

            $this->audit->record('goods_receipt.posted', $receipt, new: [
                'number' => $receipt->receipt_number, 'po_number' => $order->po_number, 'total_cost' => $receipt->total_cost, 'order_status' => $order->status->value,
            ]);

            return $receipt->refresh();
        });
    }

    private function nextNumber(): string
    {
        $last = GoodsReceipt::where('receipt_number', 'like', 'GR-%')->orderByDesc('receipt_number')->lockForUpdate()->value('receipt_number');

        return sprintf('GR-%06d', $last === null ? 1 : (int) substr($last, 3) + 1);
    }

    private function trim(string $quantity): string
    {
        return rtrim(rtrim($quantity, '0'), '.') ?: '0';
    }

    private function invalid(string $field, string $message): never
    {
        throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => [$field => [$message]]]);
    }
}
