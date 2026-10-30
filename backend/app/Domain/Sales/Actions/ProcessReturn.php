<?php

namespace App\Domain\Sales\Actions;

use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Inventory\Services\StockLedger;
use App\Domain\Sales\Enums\ReturnItemCondition;
use App\Domain\Sales\Enums\SaleStatus;
use App\Domain\Sales\Pricing\FixedPoint;
use App\Domain\Sales\Services\SupervisorApproval;
use App\Models\CashierShift;
use App\Models\Device;
use App\Models\PaymentMethod;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use App\Models\Store;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Returns some or all items of a completed sale and refunds the customer.
 * Needs sales.return (or a manager's approval) and an open shift on this
 * terminal, because a cash refund leaves this drawer.
 *
 * Refunds are what the customer actually paid for the line (after discounts),
 * pro rata. The last return of a line refunds exactly what is left, so the
 * refunds of a line never add up to more or less than its total.
 * Resellable goods go back to stock (sale_return movements); damaged or
 * expired goods are recorded without restocking.
 */
class ProcessReturn
{
    private const SCALE = 4;

    public function __construct(
        private readonly SupervisorApproval $approval,
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    /** @param array<string, mixed> $input validated ReturnRequest data */
    public function execute(Sale $sale, Device $device, User $actor, array $input): SaleReturn
    {
        $approver = $this->approval->authorize($actor, 'sales.return', $input['approval'] ?? null, "A return on {$sale->receipt_number}");

        $shift = CashierShift::where('device_id', $device->id)->where('status', ShiftStatus::Open)->first();
        if ($shift === null) {
            throw new BusinessException('Open a shift on this terminal before processing a return.', ErrorCode::ShiftRequired, 409);
        }

        $method = PaymentMethod::where('code', $input['refund_method'])->where('is_active', true)->first()
            ?? $this->invalid('refund_method', 'This refund method is not available.');
        if ($method->requires_reference && blank($input['refund_reference'] ?? null)) {
            $this->invalid('refund_reference', "Enter the {$method->name} reference number of the refund.");
        }

        return DB::transaction(function () use ($sale, $device, $actor, $approver, $shift, $method, $input) {
            $sale = Sale::whereKey($sale->id)->lockForUpdate()->with('items.unit', 'items.returnItems')->firstOrFail();
            if ($sale->status !== SaleStatus::Completed) {
                throw new BusinessException("{$sale->receipt_number} was voided; there is nothing to return.", ErrorCode::Conflict, 409);
            }

            $lines = $this->lines($sale, $input['items']);
            $store = Store::findOrFail($sale->store_id);
            $now = now();

            $total = array_sum(array_column($lines, 'refund'));
            $return = SaleReturn::create([
                'store_id' => $sale->store_id,
                'sale_id' => $sale->id,
                'device_id' => $device->id,
                'cashier_shift_id' => $shift->id,
                'return_number' => $this->nextNumber(),
                'reason' => $input['reason'],
                'subtotal' => FixedPoint::format($total),
                'vat_amount' => FixedPoint::format(array_sum(array_column($lines, 'tax'))),
                'total_refund' => FixedPoint::format($total),
                'processed_by' => $actor->id,
                'approved_by' => $approver->id,
                'occurred_at' => $now,
                'business_date' => $now->copy()->setTimezone($store->timezone)->toDateString(),
                'synced_at' => $now,
            ]);

            foreach ($lines as $line) {
                $condition = $line['condition'];
                $item = SaleReturnItem::create([
                    'sale_return_id' => $return->id,
                    'sale_item_id' => $line['item']->id,
                    'product_sku_id' => $line['item']->product_sku_id,
                    'stock_batch_id' => $line['item']->stock_batch_id,
                    'quantity' => $line['quantity'],
                    'base_quantity' => bcmul($line['quantity'], $line['item']->conversion_factor, self::SCALE),
                    'unit_price' => $line['item']->unit_price,
                    'tax_amount' => FixedPoint::format($line['tax']),
                    'refund_amount' => FixedPoint::format($line['refund']),
                    'restock' => $condition === ReturnItemCondition::Resellable,
                    'condition' => $condition,
                    'created_at' => $now,
                ]);

                if ($item->restock) {
                    $this->ledger->restockReturn($return, $item, $line['item'], $actor);
                }
            }

            if ($total > 0) {
                $return->refunds()->create([
                    'payment_method_id' => $method->id,
                    'method_code' => $method->code,
                    'amount' => FixedPoint::format($total),
                    'reference_number' => $method->requires_reference ? trim($input['refund_reference']) : null,
                    'refunded_at' => $now,
                    'created_at' => $now,
                ]);
            }

            $this->audit->record('sale.returned', $return, new: [
                'return_number' => $return->return_number, 'receipt_number' => $sale->receipt_number,
                'total_refund' => $return->total_refund, 'refund_method' => $method->code, 'approved_by' => $approver->id,
            ], device: $device);

            return $return;
        });
    }

    /** @return list<array{item: SaleItem, quantity: string, condition: ReturnItemCondition, refund: int, tax: int}> */
    private function lines(Sale $sale, array $input): array
    {
        $items = $sale->items->keyBy('id');
        $lines = [];

        foreach ($input as $i => $row) {
            $item = $items->get($row['sale_item_id']) ?? $this->invalid("items.{$i}.sale_item_id", 'This item is not on the receipt.');
            $quantity = bcadd((string) $row['quantity'], '0', self::SCALE);
            $returned = $item->returnItems->reduce(fn ($carry, $r) => bcadd($carry, $r->quantity, self::SCALE), '0');
            $left = bcsub($item->quantity, $returned, self::SCALE);

            if (! $item->unit->allows_decimal && bccomp($quantity, (string) (int) $quantity, self::SCALE) !== 0) {
                $this->invalid("items.{$i}.quantity", "{$item->unit_name} must be a whole number.");
            }
            if (bccomp($quantity, $left, self::SCALE) > 0) {
                $this->invalid("items.{$i}.quantity", "Only {$this->trim($left)} {$item->unit_name} of {$item->product_name} can still be returned.");
            }

            $refunded = $item->returnItems->sum(fn ($r) => FixedPoint::cents($r->refund_amount));
            $taxRefunded = $item->returnItems->sum(fn ($r) => FixedPoint::cents($r->tax_amount));
            $lineTotal = FixedPoint::cents($item->line_total);
            $lineTax = FixedPoint::cents($item->tax_amount);

            if (bccomp($quantity, $left, self::SCALE) === 0) {
                $refund = $lineTotal - $refunded;
                $tax = $lineTax - $taxRefunded;
            } else {
                $refund = FixedPoint::roundCents(bcdiv(bcmul($item->line_total, $quantity, 10), $item->quantity, 10));
                $tax = FixedPoint::roundCents(bcdiv(bcmul($item->tax_amount, $quantity, 10), $item->quantity, 10));
            }

            $lines[] = [
                'item' => $item,
                'quantity' => $quantity,
                'condition' => ReturnItemCondition::from($row['condition'] ?? 'resellable'),
                'refund' => $refund,
                'tax' => $tax,
            ];
        }

        return $lines;
    }

    private function nextNumber(): string
    {
        $last = SaleReturn::query()->where('return_number', 'like', 'RET-%')->orderByDesc('return_number')->lockForUpdate()->value('return_number');

        return sprintf('RET-%06d', $last === null ? 1 : (int) substr($last, 4) + 1);
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
