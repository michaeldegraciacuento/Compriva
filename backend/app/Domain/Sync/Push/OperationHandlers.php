<?php

namespace App\Domain\Sync\Push;

use App\Domain\Cashiering\Enums\CashMovementType;
use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Cashiering\Queries\ShiftSummary;
use App\Domain\Catalog\Enums\PriceTier;
use App\Domain\Customers\SaleCustomer;
use App\Domain\Inventory\Services\StockAllocations;
use App\Domain\Inventory\Services\StockLedger;
use App\Domain\Sales\Enums\SaleStatus;
use App\Domain\Sales\Pricing\CartCalculator;
use App\Domain\Sales\Pricing\FixedPoint;
use App\Domain\Sales\Pricing\TenderCalculator;
use App\Models\CashierShift;
use App\Models\CashMovement;
use App\Models\Device;
use App\Models\PaymentMethod;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Store;
use App\Models\SyncConflict;
use App\Models\Unit;
use App\Models\User;
use App\Support\Errors\BusinessException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;

/**
 * Validates and applies each operation type a terminal pushes. Runs inside the
 * operation's transaction (ApplyOperations). Nothing a terminal says is taken
 * on trust: users, permissions, shifts, SKUs and units are checked, and every
 * sale is recalculated with the shared CartCalculator and TenderCalculator;
 * a sale whose amounts do not add up is rejected.
 *
 * What is NOT rejected: an offline sale that the server's own view disagrees
 * with (stock ran short, the terminal sold beyond its allocation, prices
 * changed meanwhile). The goods are gone, so the sale is recorded and a
 * SyncConflict is raised for a manager.
 */
class OperationHandlers
{
    public const TYPES = ['shift.opened', 'shift.closed', 'cash.movement', 'sale.completed', 'sale.voided', 'allocation.release'];

    private const SCALE = 4;

    /** Conflicts found while applying the current operation. @var list<array<string, mixed>> */
    private array $conflicts = [];

    private ?string $operationId = null;

    public function __construct(
        private readonly CartCalculator $calculator,
        private readonly TenderCalculator $tenders,
        private readonly StockLedger $ledger,
        private readonly StockAllocations $allocations,
        private readonly ShiftSummary $summary,
    ) {}

    /** @return array<string, mixed> result stored with the operation and returned to the terminal */
    public function apply(Device $device, array $op): array
    {
        $this->conflicts = [];
        $this->operationId = $op['operation_id'];
        $payload = $op['payload'];

        $result = match ($op['type']) {
            'shift.opened' => $this->shiftOpened($device, $payload),
            'shift.closed' => $this->shiftClosed($device, $payload),
            'cash.movement' => $this->cashMovement($device, $payload),
            'sale.completed' => $this->saleCompleted($device, $payload),
            'sale.voided' => $this->saleVoided($device, $payload),
            'allocation.release' => $this->allocationRelease($device, $payload),
            default => throw new OperationRejected("Unknown operation type {$op['type']}."),
        };

        return $result + ['conflicts' => $this->conflicts];
    }

    // --- Shifts ------------------------------------------------------------------

    private function shiftOpened(Device $device, array $p): array
    {
        $this->validate($p, [
            'shift_id' => ['required', 'uuid'],
            'cashier_id' => ['required', 'uuid'],
            'opening_float' => ['required', 'decimal:0,4', 'min:0'],
            'opened_at' => ['required', 'date'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
        $cashier = $this->user($p['cashier_id'], 'cashier.shift', 'open a shift');

        if ($shift = CashierShift::find($p['shift_id'])) {
            $this->assertDevice($shift->device_id, $device);

            return ['shift_id' => $shift->id];
        }

        // Only one shift may be open per terminal. A newer shift from the terminal wins; the old one is
        // closed without a count and flagged (e.g. a shift opened online on the same terminal).
        $other = CashierShift::where('device_id', $device->id)->where('status', ShiftStatus::Open)->first();
        if ($other !== null) {
            $other->forceFill(['status' => ShiftStatus::Closed, 'closed_at' => Carbon::parse($p['opened_at']), 'notes' => trim(($other->notes ?? '')."\nClosed automatically: terminal {$device->code} opened another shift.")])->save();
            $this->conflict($device, 'shift_replaced', 'cashier_shift', $other->id, "{$other->cashier->name}'s shift was still open on {$device->code} when the terminal opened a new one; it was closed without a cash count.");
        }

        $shift = CashierShift::create([
            'id' => $p['shift_id'],
            'store_id' => $device->store_id,
            'device_id' => $device->id,
            'cashier_id' => $cashier->id,
            'status' => ShiftStatus::Open,
            'opening_float' => $p['opening_float'],
            'opened_at' => Carbon::parse($p['opened_at']),
            'notes' => $p['notes'] ?? null,
            'open_operation_id' => $this->operationId,
        ]);

        return ['shift_id' => $shift->id];
    }

    private function shiftClosed(Device $device, array $p): array
    {
        $this->validate($p, [
            'shift_id' => ['required', 'uuid'],
            'closed_by' => ['required', 'uuid'],
            'counted_cash' => ['required', 'decimal:0,4', 'min:0'],
            'expected_cash' => ['required', 'decimal:0,4'],
            'closed_at' => ['required', 'date'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
        $shift = $this->shift($p['shift_id'], $device);
        if ($shift->status === ShiftStatus::Closed) {
            return ['shift_id' => $shift->id, 'already_closed' => true];
        }
        $closer = $this->user($p['closed_by']);
        if ($closer->id !== $shift->cashier_id && ! $closer->hasPermission('cashier.manage_shifts')) {
            throw new OperationRejected("{$closer->name} may not close another cashier's shift.", 'FORBIDDEN');
        }

        $expected = $this->summary->for($shift)['expected_cash'];
        if (bccomp($expected, (string) $p['expected_cash'], self::SCALE) !== 0) {
            $this->conflict($device, 'expected_cash', 'cashier_shift', $shift->id,
                "The terminal expected ₱{$p['expected_cash']} in the drawer, the server ₱{$expected}.", ['terminal' => $p['expected_cash'], 'server' => $expected]);
        }

        $shift->forceFill([
            'status' => ShiftStatus::Closed,
            'expected_cash' => $expected,
            'counted_cash' => $p['counted_cash'],
            'cash_variance' => bcsub((string) $p['counted_cash'], $expected, self::SCALE),
            'closed_at' => Carbon::parse($p['closed_at']),
            'closed_by' => $closer->id,
            'notes' => trim(implode("\n", array_filter([$shift->notes, $p['notes'] ?? null]))) ?: null,
            'close_operation_id' => $this->operationId,
        ])->save();

        return ['shift_id' => $shift->id, 'expected_cash' => $expected, 'cash_variance' => $shift->cash_variance];
    }

    private function cashMovement(Device $device, array $p): array
    {
        $this->validate($p, [
            'id' => ['required', 'uuid'],
            'shift_id' => ['required', 'uuid'],
            'type' => ['required', 'in:cash_in,cash_out,cash_drop'],
            'amount' => ['required', 'decimal:0,4', 'gt:0'],
            'reason' => ['required', 'string', 'max:255'],
            'performed_by' => ['required', 'uuid'],
            'approved_by' => ['nullable', 'uuid'],
            'occurred_at' => ['required', 'date'],
        ]);
        if (CashMovement::find($p['id'])) {
            return ['cash_movement_id' => $p['id']];
        }
        $shift = $this->shift($p['shift_id'], $device);
        $performer = $this->user($p['performed_by']);
        $this->authorizedBy($performer, $p['approved_by'] ?? null, 'cashier.cash_movements', 'cash in or out');

        CashMovement::create([
            'id' => $p['id'],
            'cashier_shift_id' => $shift->id,
            'type' => CashMovementType::from($p['type']),
            'amount' => $p['amount'],
            'reason' => $p['reason'],
            'performed_by' => $performer->id,
            'approved_by' => $p['approved_by'] ?? null,
            'occurred_at' => Carbon::parse($p['occurred_at']),
            'operation_id' => $this->operationId,
            'created_at' => now(),
        ]);

        return ['cash_movement_id' => $p['id']];
    }

    // --- Sales -------------------------------------------------------------------

    private function saleCompleted(Device $device, array $p): array
    {
        $this->validate($p, [
            'id' => ['required', 'uuid'],
            'receipt_number' => ['required', 'string', 'max:30'],
            'receipt_sequence' => ['required', 'integer', 'min:1'],
            'shift_id' => ['required', 'uuid'],
            'cashier_id' => ['required', 'uuid'],
            'occurred_at' => ['required', 'date'],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'customer_id' => ['nullable', 'uuid'],
            'approved_by' => ['nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.id' => ['required', 'uuid', 'distinct'],
            'lines.*.sku_id' => ['required', 'uuid'],
            'lines.*.unit_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'decimal:0,4', 'gt:0'],
            'lines.*.factor' => ['required', 'decimal:0,6', 'gt:0'],
            'lines.*.regular_unit_price' => ['required', 'decimal:0,4', 'min:0'],
            'lines.*.unit_price' => ['required', 'decimal:0,4', 'min:0'],
            'lines.*.product_name' => ['required', 'string', 'max:255'],
            'lines.*.sku_code' => ['required', 'string', 'max:50'],
            'lines.*.unit_name' => ['required', 'string', 'max:50'],
            'lines.*.barcode' => ['nullable', 'string', 'max:64'],
            'lines.*.tax' => ['required', 'array'],
            'lines.*.tax.id' => ['required', 'uuid'],
            'lines.*.tax.code' => ['required', 'string', 'max:20'],
            'lines.*.tax.type' => ['required', 'in:vat,vat_exempt,zero_rated,non_vat'],
            'lines.*.tax.rate' => ['required', 'decimal:0,4'],
            'lines.*.tax.inclusive' => ['required', 'boolean'],
            'lines.*.discount' => ['nullable', 'array'],
            'lines.*.discount.type' => ['required_with:lines.*.discount', 'in:percentage,fixed_amount'],
            'lines.*.discount.value' => ['required_with:lines.*.discount', 'decimal:0,4', 'gt:0'],
            'discount' => ['nullable', 'array'],
            'discount.type' => ['required_with:discount', 'in:percentage,fixed_amount'],
            'discount.value' => ['required_with:discount', 'decimal:0,4', 'gt:0'],
            'discount.discount_id' => ['nullable', 'uuid'],
            'discount.max_amount' => ['nullable', 'decimal:0,4'],
            'payments' => ['present', 'array', 'max:10'],
            'payments.*.method' => ['required', 'string', 'max:30'],
            'payments.*.amount' => ['required', 'decimal:0,4', 'gt:0'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],
            'totals' => ['required', 'array'],
            'totals.*' => ['decimal:0,4'],
        ]);

        if ($existing = Sale::find($p['id'])) {
            $this->assertDevice($existing->device_id, $device);

            return ['sale_id' => $existing->id, 'receipt_number' => $existing->receipt_number];
        }
        if (Sale::where('receipt_number', $p['receipt_number'])->exists()) {
            throw new OperationRejected("Receipt number {$p['receipt_number']} is already used by another sale.", 'CONFLICT');
        }

        $shift = $this->shift($p['shift_id'], $device);
        $cashier = $this->user($p['cashier_id'], 'pos.access', 'sell');
        if ($shift->cashier_id !== $cashier->id) {
            throw new OperationRejected('The sale belongs to a shift of another cashier.', 'FORBIDDEN');
        }

        // 1. The amounts must be exactly what the shared calculator gives for these lines.
        $saleDiscount = $p['discount'] ?? null;
        $calc = $this->calculator->calculate(
            array_map(fn (array $l) => [
                'quantity' => (string) $l['quantity'], 'unit_price' => (string) $l['unit_price'],
                'tax_type' => $l['tax']['type'], 'tax_rate' => (string) $l['tax']['rate'], 'tax_inclusive' => (bool) $l['tax']['inclusive'],
                'discount' => $l['discount'] ?? null,
            ], $p['lines']),
            $saleDiscount === null ? null : ['type' => $saleDiscount['type'], 'value' => (string) $saleDiscount['value'],
                'vat_exempt' => (bool) ($saleDiscount['is_vat_exempt'] ?? false), 'max_amount' => $saleDiscount['max_amount'] ?? null],
        );
        foreach ($calc['totals'] as $key => $value) {
            if (FixedPoint::cents((string) ($p['totals'][$key] ?? 'x0')) !== FixedPoint::cents($value)) {
                throw new OperationRejected("The sale's {$key} does not match its lines (₱{$value}).", 'INVALID_PAYLOAD');
            }
        }

        // 2. Payments must cover the total by the same rules as online checkout.
        $methods = PaymentMethod::whereIn('code', array_column($p['payments'], 'method'))->get()->keyBy('code');
        foreach ($p['payments'] as $payment) {
            if (! $methods->has($payment['method'])) {
                throw new OperationRejected("Unknown payment method {$payment['method']}.", 'INVALID_PAYLOAD');
            }
        }
        try {
            $tendered = $this->tenders->apply($calc['totals']['grand_total'], array_map(fn ($pay) => [
                'allows_change' => $methods[$pay['method']]->allows_change, 'tendered' => (string) $pay['amount'],
            ], $p['payments']));
        } catch (BusinessException $e) {
            throw new OperationRejected("Payment does not add up: {$e->getMessage()}", 'INVALID_PAYLOAD');
        }

        // 3. Discounts and price changes need someone who may give them.
        $needs = [];
        foreach ($p['lines'] as $l) {
            if (bccomp((string) $l['unit_price'], (string) $l['regular_unit_price'], self::SCALE) !== 0) {
                $needs[] = 'pos.price_override';
            }
            if (! empty($l['discount'])) {
                $needs[] = 'pos.apply_discount';
            }
        }
        if ($saleDiscount !== null && (($saleDiscount['discount_id'] ?? null) === null || ($saleDiscount['requires_approval'] ?? false))) {
            $needs[] = 'pos.apply_discount';
        }
        $approver = null;
        foreach (array_unique($needs) as $permission) {
            $approver = $this->authorizedBy($cashier, $p['approved_by'] ?? null, $permission, 'this discount or price change');
        }

        // 4. Record the sale from its snapshot.
        $store = Store::findOrFail($device->store_id);
        $occurred = Carbon::parse($p['occurred_at']);
        $sale = Sale::create([
            'id' => $p['id'],
            'store_id' => $store->id,
            'device_id' => $device->id,
            'cashier_shift_id' => $shift->id,
            'cashier_id' => $cashier->id,
            'receipt_number' => $p['receipt_number'],
            'receipt_sequence' => $p['receipt_sequence'],
            'status' => SaleStatus::Completed,
            // Never rejected for its customer: a customer deactivated meanwhile keeps the link (SaleCustomer).
            ...SaleCustomer::resolve($p['customer_id'] ?? null, $p['customer_name'] ?? null, offline: true)['columns'],
            'customer_id_number' => $saleDiscount['customer_id_number'] ?? null,
            'gross_amount' => $calc['totals']['gross_amount'],
            'discount_total' => $calc['totals']['discount_total'],
            'vatable_sales' => $calc['totals']['vatable_sales'],
            'vat_amount' => $calc['totals']['vat_amount'],
            'vat_exempt_sales' => $calc['totals']['vat_exempt_sales'],
            'zero_rated_sales' => $calc['totals']['zero_rated_sales'],
            'rounding_adjustment' => '0',
            'grand_total' => $calc['totals']['grand_total'],
            'amount_paid' => $tendered['amount_paid'],
            'change_due' => $tendered['change_due'],
            'occurred_at' => $occurred,
            'business_date' => $occurred->copy()->setTimezone($store->timezone)->toDateString(),
            'synced_at' => now(),
            'operation_id' => $this->operationId,
        ]);

        $skus = ProductSku::withTrashed()->with(['product' => fn ($q) => $q->withTrashed()])->whereIn('id', array_column($p['lines'], 'sku_id'))->get()->keyBy('id');
        $units = Unit::whereIn('id', array_column($p['lines'], 'unit_id'))->get()->keyBy('id');
        $shortages = [];

        foreach ($p['lines'] as $i => $l) {
            $sku = $skus->get($l['sku_id']) ?? throw new OperationRejected('Line '.($i + 1).': unknown product.', 'INVALID_PAYLOAD');
            $units->get($l['unit_id']) ?? throw new OperationRejected('Line '.($i + 1).': unknown unit.', 'INVALID_PAYLOAD');
            $amounts = $calc['lines'][$i];
            $factor = bcadd((string) $l['factor'], '0', 6);
            $baseQuantity = bcmul((string) $l['quantity'], $factor, self::SCALE);

            // Allocation first (releases the reserved units), then the stock itself.
            $beyondAllocation = $sku->product->track_inventory
                ? $this->allocations->consume($device, $sku, $baseQuantity, $sale->id, $this->operationId) : '0';
            $stock = $this->ledger->sell($sale, $l['id'], $sku, $baseQuantity, $cashier, offline: true);

            SaleItem::create([
                'id' => $l['id'],
                'sale_id' => $sale->id,
                'line_number' => $i + 1,
                'product_sku_id' => $sku->id,
                'unit_id' => $l['unit_id'],
                'stock_batch_id' => $stock['batch_id'],
                'product_name' => $l['product_name'],
                'sku_code' => $l['sku_code'],
                'barcode' => $l['barcode'] ?? null,
                'unit_name' => $l['unit_name'],
                'conversion_factor' => $factor,
                'quantity' => $l['quantity'],
                'base_quantity' => $baseQuantity,
                'regular_unit_price' => $l['regular_unit_price'],
                'unit_price' => $l['unit_price'],
                'price_override_by' => bccomp((string) $l['unit_price'], (string) $l['regular_unit_price'], self::SCALE) !== 0 ? $approver?->id : null,
                'unit_cost' => bcmul($stock['unit_cost'], $factor, self::SCALE),
                'gross_amount' => $amounts['gross'],
                'discount_amount' => $amounts['discount'],
                'tax_rate_id' => $l['tax']['id'],
                'tax_code' => $l['tax']['code'],
                'tax_type' => $amounts['vat_exempted'] ? 'vat_exempt' : $l['tax']['type'],
                'tax_rate' => $amounts['vat_exempted'] ? '0' : $l['tax']['rate'],
                'taxable_amount' => $amounts['taxable'],
                'tax_amount' => $amounts['tax'],
                'line_total' => $amounts['total'],
                'over_allocation' => bccomp($beyondAllocation, '0', self::SCALE) > 0,
                'created_at' => $occurred,
            ]);

            if (! empty($l['discount'])) {
                $sale->discounts()->create([
                    'sale_item_id' => $l['id'], 'name' => 'Item discount', 'kind' => 'manual', 'type' => $l['discount']['type'],
                    'value' => $l['discount']['value'], 'amount' => $amounts['item_discount'], 'approved_by' => $approver?->id, 'created_at' => $occurred,
                ]);
            }

            if (bccomp($beyondAllocation, '0', self::SCALE) > 0) {
                $this->conflict($device, 'over_allocation', 'sale_item', $l['id'],
                    "{$l['product_name']}: sold {$this->trim($beyondAllocation)} more than terminal {$device->code} was allocated ({$p['receipt_number']}).",
                    ['sku_id' => $sku->id, 'quantity' => $beyondAllocation, 'receipt_number' => $p['receipt_number']]);
            }
            if (bccomp($stock['shortage'], '0', self::SCALE) > 0) {
                $shortages[] = $sku->id;
                $this->conflict($device, 'stock_shortage', 'sale_item', $l['id'],
                    "{$l['product_name']}: {$this->trim($stock['shortage'])} sold beyond the stock on record ({$p['receipt_number']}). Count it to correct the stock.",
                    ['sku_id' => $sku->id, 'quantity' => $stock['shortage'], 'receipt_number' => $p['receipt_number']]);
            }
            $this->checkPrice($device, $sku->id, $l, $occurred, $p['receipt_number']);
        }

        if ($saleDiscount !== null) {
            $sale->discounts()->create([
                'discount_id' => $saleDiscount['discount_id'] ?? null,
                'name' => $saleDiscount['name'] ?? 'Discount',
                'kind' => $saleDiscount['kind'] ?? 'manual',
                'type' => $saleDiscount['type'],
                'value' => $saleDiscount['value'],
                'amount' => FixedPoint::format(array_sum(array_map(fn ($l) => FixedPoint::cents($l['sale_discount']), $calc['lines']))),
                'customer_id_number' => $saleDiscount['customer_id_number'] ?? null,
                'approved_by' => in_array('pos.apply_discount', $needs, true) ? $approver?->id : null,
                'created_at' => $occurred,
            ]);
        }

        foreach ($p['payments'] as $i => $payment) {
            $method = $methods[$payment['method']];
            $sale->payments()->create([
                'payment_method_id' => $method->id,
                'method_code' => $method->code,
                'amount' => $tendered['tenders'][$i]['amount'],
                'tendered_amount' => $tendered['tenders'][$i]['tendered'],
                'change_amount' => $tendered['tenders'][$i]['change'],
                'reference_number' => $payment['reference'] ?? null,
                'paid_at' => $occurred,
                'created_at' => $occurred,
            ]);
        }

        if ($device->last_receipt_sequence < $p['receipt_sequence']) {
            $device->forceFill(['last_receipt_sequence' => $p['receipt_sequence']])->save();
        }

        return ['sale_id' => $sale->id, 'receipt_number' => $sale->receipt_number];
    }

    private function saleVoided(Device $device, array $p): array
    {
        $this->validate($p, [
            'sale_id' => ['required', 'uuid'],
            'requested_by' => ['required', 'uuid'],
            'approved_by' => ['nullable', 'uuid'],
            'reason' => ['required', 'string', 'max:255'],
            'voided_at' => ['required', 'date'],
        ]);
        $sale = Sale::whereKey($p['sale_id'])->lockForUpdate()->first() ?? throw new OperationRejected('The sale to void does not exist.', 'NOT_FOUND');
        $this->assertDevice($sale->device_id, $device);
        if ($sale->status === SaleStatus::Voided) {
            return ['sale_id' => $sale->id, 'already_voided' => true];
        }
        if ($sale->returns()->exists()) {
            throw new OperationRejected("{$sale->receipt_number} has returns and cannot be voided.", 'CONFLICT');
        }
        $requester = $this->user($p['requested_by']);
        $approver = $this->authorizedBy($requester, $p['approved_by'] ?? null, 'sales.void', 'a void');

        $this->ledger->reverseSale($sale, $requester);
        foreach ($sale->items()->with('sku.product')->get() as $item) {
            // The voided goods are back on the terminal's shelf: give them back to its allocation.
            if ($item->sku->product->track_inventory) {
                $this->allocations->restore($device, $item->sku, $item->base_quantity, $sale->id, $this->operationId);
            }
        }
        $sale->forceFill(['status' => SaleStatus::Voided, 'voided_at' => Carbon::parse($p['voided_at']), 'voided_by' => $approver->id,
            'void_reason' => $p['reason'], 'void_operation_id' => $this->operationId])->save();

        return ['sale_id' => $sale->id];
    }

    private function allocationRelease(Device $device, array $p): array
    {
        $this->validate($p, ['sku_id' => ['required', 'uuid'], 'quantity' => ['required', 'decimal:0,4', 'gt:0']]);
        $sku = ProductSku::find($p['sku_id']) ?? throw new OperationRejected('Unknown product.', 'INVALID_PAYLOAD');
        $allocation = $this->allocations->release($device, $sku, (string) $p['quantity'], $this->operationId);

        return ['sku_id' => $sku->id, 'remaining' => $allocation->availableQuantity()];
    }

    // --- Helpers -----------------------------------------------------------------

    private function checkPrice(Device $device, string $skuId, array $line, Carbon $at, string $receipt): void
    {
        $price = ProductPrice::where('product_sku_id', $skuId)->where('unit_id', $line['unit_id'])->where('tier', PriceTier::Retail)
            ->effectiveAt($at)->orderByDesc('effective_from')->value('price');
        if ($price !== null && bccomp($price, (string) $line['regular_unit_price'], self::SCALE) !== 0) {
            $this->conflict($device, 'price_changed', 'sale_item', $line['id'],
                "{$line['product_name']}: sold at the terminal's price ₱{$line['regular_unit_price']}, the server price was ₱{$price} ({$receipt}).",
                ['sku_id' => $skuId, 'terminal_price' => $line['regular_unit_price'], 'server_price' => $price]);
        }
    }

    private function validate(array $payload, array $rules): void
    {
        $validator = Validator::make($payload, $rules);
        if ($validator->fails()) {
            throw new OperationRejected('Invalid operation: '.$validator->errors()->first(), 'VALIDATION_FAILED');
        }
    }

    private function user(string $id, ?string $permission = null, string $action = ''): User
    {
        $user = User::find($id) ?? throw new OperationRejected('Unknown user.', 'INVALID_PAYLOAD');
        if ($permission !== null && ! $user->hasPermission($permission)) {
            throw new OperationRejected("{$user->name} may not {$action}.", 'FORBIDDEN');
        }

        return $user;
    }

    /** The actor holds the permission, or the named approver does. */
    private function authorizedBy(User $actor, ?string $approverId, string $permission, string $action): User
    {
        if ($actor->hasPermission($permission)) {
            return $actor;
        }
        $approver = $approverId === null ? null : User::find($approverId);
        if ($approver === null || ! $approver->hasPermission($permission)) {
            throw new OperationRejected(ucfirst($action).' was not approved by someone allowed to.', 'FORBIDDEN');
        }

        return $approver;
    }

    private function shift(string $id, Device $device): CashierShift
    {
        $shift = CashierShift::whereKey($id)->lockForUpdate()->first() ?? throw new OperationRejected('The shift is unknown; its opening must be synced first.', 'NOT_FOUND');
        $this->assertDevice($shift->device_id, $device);

        return $shift;
    }

    private function assertDevice(string $deviceId, Device $device): void
    {
        if ($deviceId !== $device->id) {
            throw new OperationRejected('This record belongs to another terminal.', 'FORBIDDEN');
        }
    }

    private function conflict(Device $device, string $type, ?string $entity, ?string $entityId, string $message, array $details = []): void
    {
        $conflict = SyncConflict::create([
            'device_id' => $device->id,
            'operation_id' => $this->operationId,
            'type' => $type,
            'entity' => $entity,
            'entity_id' => $entityId,
            'message' => mb_substr($message, 0, 255),
            'details' => $details ?: null,
            'detected_at' => now(),
        ]);
        $this->conflicts[] = ['id' => $conflict->id, 'type' => $type, 'message' => $conflict->message];
    }

    private function trim(string $quantity): string
    {
        return rtrim(rtrim($quantity, '0'), '.') ?: '0';
    }
}
