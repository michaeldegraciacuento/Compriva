<?php

namespace App\Domain\Inventory\Services;

use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Inventory\Enums\StockDocumentType;
use App\Domain\Inventory\Enums\StockMovementType;
use App\Models\GoodsReceipt;
use App\Models\InventoryLevel;
use App\Models\ProductSku;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use App\Models\StockAdjustment;
use App\Models\StockAdjustmentItem;
use App\Models\StockBatch;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * The only writer of stock quantities.
 *
 * Posting a stock document or goods receipt, or completing, voiding or returning a sale, writes
 * one stock movement per change, and updates the inventory level (on hand,
 * weighted average cost) and the batches in the same database transaction, with row locks so concurrent postings cannot
 * oversell. InventoryLevel and StockBatch refuse quantity changes made outside
 * this class (GuardedByStockLedger).
 *
 * All arithmetic is bcmath on decimal strings (scale 4).
 */
class StockLedger
{
    private const SCALE = 4;

    private static int $writing = 0;

    public function __construct(
        private readonly FefoPicker $fefo,
        private readonly AuditLogger $audit,
    ) {}

    public static function isWriting(): bool
    {
        return self::$writing > 0;
    }

    /** Runs $change as a ledger write (for StockAllocations, which moves reserved quantities). */
    public static function writing(callable $change): mixed
    {
        self::$writing++;
        try {
            return $change();
        } finally {
            self::$writing--;
        }
    }

    /** Posts a draft document. Throws (and changes nothing) if any line cannot be applied. */
    public function post(StockAdjustment $document, User $actor): StockAdjustment
    {
        return DB::transaction(function () use ($document, $actor) {
            $document = StockAdjustment::whereKey($document->getKey())->lockForUpdate()->firstOrFail();

            if ($document->status === DocumentStatus::Posted) {
                throw new BusinessException("{$document->adjustment_number} is already posted.", ErrorCode::Conflict, 409);
            }

            $document->load('items.sku.product');

            self::$writing++;
            try {
                foreach ($document->items as $item) {
                    match ($document->type) {
                        StockDocumentType::StockIn => $this->stockIn($document, $item, $actor),
                        StockDocumentType::StockOut => $this->stockOut($document, $item, $actor),
                        StockDocumentType::Adjustment => $this->count($document, $item, $actor),
                    };
                }
            } finally {
                self::$writing--;
            }

            if ($document->items()->count() === 0) {
                throw new BusinessException('Nothing to post: every counted quantity matches the system.', ErrorCode::BusinessRuleViolation, 422, ['reason' => 'no_changes']);
            }

            $document->forceFill(['status' => DocumentStatus::Posted, 'posted_at' => now(), 'approved_by' => $actor->id])->save();
            $this->audit->record('stock_document.posted', $document, new: [
                'number' => $document->adjustment_number, 'type' => $document->type->value, 'lines' => $document->items()->count(),
            ]);

            return $document->refresh();
        });
    }

    private function stockIn(StockAdjustment $document, StockAdjustmentItem $item, User $actor): void
    {
        $sku = $item->sku;
        $quantity = $item->quantity_change;
        $cost = $item->unit_cost;
        $level = $this->level($document->store_id, $sku);
        $before = $level->quantity_on_hand;

        $batch = null;
        if ($this->tracksBatches($sku) || $item->batch_number !== null || $item->expiry_date !== null) {
            $batch = $this->receiveIntoBatch($document, $item, $sku, $quantity, $cost);
        }

        $this->move($document, $item, $sku, $quantity, $cost, $batch, $actor);

        $after = bcadd($before, $quantity, self::SCALE);
        // Weighted average cost; starts fresh when there was no stock (or negative stock).
        $average = bccomp($before, '0', self::SCALE) <= 0
            ? $cost
            : bcdiv(bcadd(bcmul($before, $level->average_cost, 8), bcmul($quantity, $cost, 8), 8), $after, self::SCALE);

        $level->forceFill(['quantity_on_hand' => $after, 'average_cost' => $average, 'last_movement_at' => now()])->save();
        $sku->forceFill(['cost_price' => $cost])->save(); // latest purchase cost per base unit

        $item->forceFill(['system_quantity' => $before, 'stock_batch_id' => $batch?->id])->save();
    }

    private function stockOut(StockAdjustment $document, StockAdjustmentItem $item, User $actor): void
    {
        $sku = $item->sku;
        $quantity = bcmul($item->quantity_change, '-1', self::SCALE); // stored negative
        $level = $this->level($document->store_id, $sku);
        $before = $level->quantity_on_hand;
        $available = bcsub($before, $level->quantity_allocated, self::SCALE);

        if (bccomp($quantity, $available, self::SCALE) > 0) {
            throw new BusinessException(
                "Not enough stock of {$sku->name}: {$this->trim($available)} available, {$this->trim($quantity)} requested.",
                ErrorCode::InsufficientStock, 422,
                ['sku_id' => $sku->id, 'available' => $available, 'requested' => $quantity],
            );
        }

        if ($item->stock_batch_id !== null || $this->tracksBatches($sku)) {
            $picks = $item->stock_batch_id !== null
                ? $this->fefo->fromBatch($item->stock_batch_id, $sku, $quantity)
                : $this->fefo->pick($document->store_id, $sku, $quantity);

            foreach ($picks as ['batch' => $batch, 'quantity' => $take]) {
                $batch->forceFill(['remaining_quantity' => bcsub($batch->remaining_quantity, $take, self::SCALE)])->save();
                $this->move($document, $item, $sku, bcmul($take, '-1', self::SCALE), $batch->unit_cost, $batch, $actor);
            }
        } else {
            $this->move($document, $item, $sku, bcmul($quantity, '-1', self::SCALE), $level->average_cost, null, $actor);
        }

        $level->forceFill(['quantity_on_hand' => bcsub($before, $quantity, self::SCALE), 'last_movement_at' => now()])->save();
        $item->forceFill(['system_quantity' => $before, 'unit_cost' => $level->average_cost])->save();
    }

    /** Physical count: sets the counted quantity, recording the difference as a movement. */
    private function count(StockAdjustment $document, StockAdjustmentItem $item, User $actor): void
    {
        $sku = $item->sku;
        $counted = $item->counted_quantity;
        $level = $this->level($document->store_id, $sku);

        if ($item->stock_batch_id !== null) {
            $batch = StockBatch::whereKey($item->stock_batch_id)->where('product_sku_id', $sku->id)->lockForUpdate()->firstOrFail();
            $system = $batch->remaining_quantity;
        } else {
            if ($this->tracksBatches($sku)) {
                throw new BusinessException("{$sku->name} is tracked by batch: count each batch separately.", ErrorCode::BusinessRuleViolation, 422, ['sku_id' => $sku->id]);
            }
            $batch = null;
            $system = $level->quantity_on_hand;
        }

        $difference = bcsub($counted, $system, self::SCALE);
        if (bccomp($difference, '0', self::SCALE) === 0) {
            $item->delete(); // nothing to record for this line

            return;
        }

        if ($batch !== null) {
            $batch->forceFill([
                'remaining_quantity' => $counted,
                'initial_quantity' => bccomp($counted, $batch->initial_quantity, self::SCALE) > 0 ? $counted : $batch->initial_quantity,
            ])->save();
        }

        $cost = $batch?->unit_cost ?? $level->average_cost;
        $this->move($document, $item, $sku, $difference, $cost, $batch, $actor);

        $level->forceFill(['quantity_on_hand' => bcadd($level->quantity_on_hand, $difference, self::SCALE), 'last_movement_at' => now()])->save();
        $item->forceFill(['system_quantity' => $system, 'quantity_change' => $difference, 'unit_cost' => $cost])->save();
    }

    // --- Purchasing ----------------------------------------------------------------

    /**
     * Posts a draft goods receipt: every line adds stock at its purchase cost
     * (weighted average cost, the SKU's latest cost), into a batch when the
     * product tracks batches or a batch number / expiry was entered. Call inside
     * the receiving transaction; the receipt is then frozen.
     */
    public function receive(GoodsReceipt $receipt, User $actor): GoodsReceipt
    {
        $receipt = GoodsReceipt::whereKey($receipt->getKey())->lockForUpdate()->firstOrFail();
        if ($receipt->status === DocumentStatus::Posted) {
            throw new BusinessException("{$receipt->receipt_number} is already posted.", ErrorCode::Conflict, 409);
        }
        $receipt->load('items.sku.product');

        self::$writing++;
        try {
            foreach ($receipt->items as $item) {
                $sku = $item->sku;
                $cost = bcdiv($item->unit_cost, $item->conversion_factor, self::SCALE); // per base unit
                $batch = null;

                if ($this->tracksBatches($sku) || $item->batch_number !== null || $item->expiry_date !== null) {
                    $number = $item->batch_number ?? $receipt->receipt_number;
                    $batch = StockBatch::where('store_id', $receipt->store_id)->where('product_sku_id', $sku->id)
                        ->where('batch_number', $number)->lockForUpdate()->first();

                    if ($batch === null) {
                        $batch = StockBatch::create([
                            'store_id' => $receipt->store_id, 'product_sku_id' => $sku->id, 'goods_receipt_item_id' => $item->id,
                            'batch_number' => $number, 'expiry_date' => $item->expiry_date, 'unit_cost' => $cost,
                            'initial_quantity' => $item->base_quantity, 'remaining_quantity' => $item->base_quantity, 'received_at' => now(),
                        ]);
                    } elseif ($item->expiry_date !== null && ($batch->expiry_date === null || ! $item->expiry_date->isSameDay($batch->expiry_date))) {
                        throw new BusinessException(
                            "Batch {$number} of {$sku->name} already exists with expiry {$batch->expiry_date?->toDateString()}.",
                            ErrorCode::BusinessRuleViolation, 422, ['batch_number' => $number],
                        );
                    } else {
                        $batch->forceFill([
                            'initial_quantity' => bcadd($batch->initial_quantity, $item->base_quantity, self::SCALE),
                            'remaining_quantity' => bcadd($batch->remaining_quantity, $item->base_quantity, self::SCALE),
                        ])->save();
                    }
                }

                StockMovement::create([
                    'store_id' => $receipt->store_id,
                    'product_sku_id' => $sku->id,
                    'stock_batch_id' => $batch?->id,
                    'type' => StockMovementType::PurchaseReceipt,
                    'quantity' => $item->base_quantity,
                    'unit_cost' => $cost,
                    'reference_type' => $receipt->getMorphClass(),
                    'reference_id' => $receipt->id,
                    'occurred_at' => now(),
                    'created_by' => $actor->id,
                ]);
                $this->addToLevel($receipt->store_id, $sku, $item->base_quantity, $cost);
                $sku->forceFill(['cost_price' => $cost])->save(); // latest purchase cost per base unit
            }
        } finally {
            self::$writing--;
        }

        $receipt->forceFill(['status' => DocumentStatus::Posted, 'posted_at' => now()])->save();

        return $receipt;
    }

    // --- Sales -------------------------------------------------------------------

    /**
     * Deducts one sale line (base units), earliest-expiring batches first.
     * Call inside the sale's transaction, before the sale item is written: the
     * movements reference the item's pre-generated ID, and the returned cost is
     * part of the item's snapshot.
     *
     * With $offline (a synced offline sale) it never refuses: missing stock is
     * booked anyway and returned as `shortage`.
     *
     * @return array{unit_cost: string, batch_id: ?string, shortage: string} cost per base unit, first batch used, quantity beyond stock on hand
     */
    public function sell(Sale $sale, string $saleItemId, ProductSku $sku, string $quantity, User $actor, bool $offline = false): array
    {
        if (! $sku->product->track_inventory) {
            return ['unit_cost' => $sku->cost_price ?? '0.0000', 'batch_id' => null, 'shortage' => '0'];
        }

        self::$writing++;
        try {
            $level = $this->level($sale->store_id, $sku);
            $before = $level->quantity_on_hand;
            $available = bcsub($before, $level->quantity_allocated, self::SCALE);
            // Offline sales are facts: the goods are gone. Record them even when the books show
            // less stock (stock goes negative); the shortage is reported for review.
            $shortage = bccomp($quantity, $before, self::SCALE) > 0 ? bcsub($quantity, bccomp($before, '0', self::SCALE) > 0 ? $before : '0', self::SCALE) : '0';

            if (! $offline && bccomp($quantity, $available, self::SCALE) > 0) {
                throw new BusinessException(
                    "Not enough stock of {$sku->name}: {$this->trim($available)} left, {$this->trim($quantity)} in the cart.",
                    ErrorCode::InsufficientStock, 422,
                    ['sku_id' => $sku->id, 'available' => $available, 'requested' => $quantity],
                );
            }

            // Batch-tracked products must come from batches; others use batches while any are left.
            // An offline sale takes what the batches still hold and books the rest on the level.
            $inBatches = (string) StockBatch::where('store_id', $sale->store_id)->where('product_sku_id', $sku->id)->sum('remaining_quantity');
            $fromBatches = $this->tracksBatches($sku) && ! $offline ? $quantity : $this->minimum($quantity, $inBatches);

            $costTotal = '0';
            $firstBatch = null;
            if (bccomp($fromBatches, '0', self::SCALE) > 0) {
                foreach ($this->fefo->pick($sale->store_id, $sku, $fromBatches) as ['batch' => $batch, 'quantity' => $take]) {
                    $batch->forceFill(['remaining_quantity' => bcsub($batch->remaining_quantity, $take, self::SCALE)])->save();
                    $this->record($sale, 'sale_item', $saleItemId, StockMovementType::Sale, $sku, bcmul($take, '-1', self::SCALE), $batch->unit_cost, $batch, $actor);
                    $costTotal = bcadd($costTotal, bcmul($take, $batch->unit_cost, 8), 8);
                    $firstBatch ??= $batch->id;
                }
            }

            $rest = bcsub($quantity, $fromBatches, self::SCALE);
            if (bccomp($rest, '0', self::SCALE) > 0) {
                $this->record($sale, 'sale_item', $saleItemId, StockMovementType::Sale, $sku, bcmul($rest, '-1', self::SCALE), $level->average_cost, null, $actor);
                $costTotal = bcadd($costTotal, bcmul($rest, $level->average_cost, 8), 8);
            }

            $level->forceFill(['quantity_on_hand' => bcsub($before, $quantity, self::SCALE), 'last_movement_at' => now()])->save();

            return ['unit_cost' => bcdiv($costTotal, $quantity, self::SCALE), 'batch_id' => $firstBatch, 'shortage' => $shortage];
        } finally {
            self::$writing--;
        }
    }

    /** Puts back everything a voided sale took, into the same batches at the same cost. */
    public function reverseSale(Sale $sale, User $actor): void
    {
        $movements = StockMovement::query()
            ->where('reference_type', 'sale_item')
            ->whereIn('reference_id', $sale->items()->select('id'))
            ->where('type', StockMovementType::Sale)
            ->with('sku.product')
            ->orderBy('id')
            ->get();

        self::$writing++;
        try {
            foreach ($movements as $movement) {
                $quantity = bcmul($movement->quantity, '-1', self::SCALE);
                $batch = $movement->stock_batch_id === null ? null
                    : StockBatch::whereKey($movement->stock_batch_id)->lockForUpdate()->first();
                $batch?->forceFill(['remaining_quantity' => bcadd($batch->remaining_quantity, $quantity, self::SCALE)])->save();

                $this->record($sale, 'sale_item', $movement->reference_id, StockMovementType::SaleVoid, $movement->sku, $quantity, $movement->unit_cost, $batch, $actor);
                $this->addToLevel($sale->store_id, $movement->sku, $quantity, $movement->unit_cost);
            }
        } finally {
            self::$writing--;
        }
    }

    /**
     * Returns resellable goods to stock: back into the batches the sale line
     * took them from (as far as those batches have room), the rest onto the
     * level, at the cost the sale recorded.
     */
    public function restockReturn(SaleReturn $return, SaleReturnItem $returnItem, SaleItem $saleItem, User $actor): void
    {
        $sku = $saleItem->sku()->with('product')->firstOrFail();
        if (! $sku->product->track_inventory) {
            return;
        }

        $cost = bcdiv($saleItem->unit_cost, $saleItem->conversion_factor, self::SCALE);
        $left = $returnItem->base_quantity;
        $source = StockMovement::where('reference_type', 'sale_item')->where('reference_id', $saleItem->id)
            ->where('type', StockMovementType::Sale)->whereNotNull('stock_batch_id')->orderBy('id')->get();

        self::$writing++;
        try {
            foreach ($source as $movement) {
                if (bccomp($left, '0', self::SCALE) <= 0) {
                    break;
                }
                $batch = StockBatch::whereKey($movement->stock_batch_id)->lockForUpdate()->first();
                $room = bcsub($batch->initial_quantity, $batch->remaining_quantity, self::SCALE);
                $put = $this->minimum($this->minimum($left, bcmul($movement->quantity, '-1', self::SCALE)), $room);
                if (bccomp($put, '0', self::SCALE) <= 0) {
                    continue;
                }
                $batch->forceFill(['remaining_quantity' => bcadd($batch->remaining_quantity, $put, self::SCALE)])->save();
                $this->record($return, 'sale_return_item', $returnItem->id, StockMovementType::SaleReturn, $sku, $put, $cost, $batch, $actor);
                $left = bcsub($left, $put, self::SCALE);
            }
            if (bccomp($left, '0', self::SCALE) > 0) {
                $this->record($return, 'sale_return_item', $returnItem->id, StockMovementType::SaleReturn, $sku, $left, $cost, null, $actor);
            }

            $this->addToLevel($return->store_id, $sku, $returnItem->base_quantity, $cost);
        } finally {
            self::$writing--;
        }
    }

    /** Adds stock to a level, folding the cost into the weighted average. */
    private function addToLevel(string $storeId, ProductSku $sku, string $quantity, string $cost): void
    {
        $level = $this->level($storeId, $sku);
        $before = $level->quantity_on_hand;
        $after = bcadd($before, $quantity, self::SCALE);
        $average = bccomp($before, '0', self::SCALE) <= 0 || bccomp($after, '0', self::SCALE) <= 0
            ? $cost
            : bcdiv(bcadd(bcmul($before, $level->average_cost, 8), bcmul($quantity, $cost, 8), 8), $after, self::SCALE);

        $level->forceFill(['quantity_on_hand' => $after, 'average_cost' => $average, 'last_movement_at' => now()])->save();
    }

    /** Movement for a sale, void or return line (reference = the line). */
    private function record(Sale|SaleReturn $source, string $referenceType, string $referenceId, StockMovementType $type, ProductSku $sku, string $quantity, string $cost, ?StockBatch $batch, User $actor): void
    {
        StockMovement::create([
            'store_id' => $source->store_id,
            'product_sku_id' => $sku->id,
            'stock_batch_id' => $batch?->id,
            'device_id' => $source->device_id,
            'type' => $type,
            'quantity' => $quantity,
            'unit_cost' => $cost,
            'reference_type' => $referenceType,
            'reference_id' => $referenceId,
            'occurred_at' => now(),
            'created_by' => $actor->id,
        ]);
    }

    private function minimum(string $a, string $b): string
    {
        return bccomp($a, $b, self::SCALE) <= 0 ? $a : $b;
    }

    private function receiveIntoBatch(StockAdjustment $document, StockAdjustmentItem $item, ProductSku $sku, string $quantity, string $cost): StockBatch
    {
        $number = $item->batch_number ?? $document->adjustment_number;
        $batch = StockBatch::where('store_id', $document->store_id)
            ->where('product_sku_id', $sku->id)
            ->where('batch_number', $number)
            ->lockForUpdate()
            ->first();

        if ($batch === null) {
            return StockBatch::create([
                'store_id' => $document->store_id,
                'product_sku_id' => $sku->id,
                'batch_number' => $number,
                'expiry_date' => $item->expiry_date,
                'unit_cost' => $cost,
                'initial_quantity' => $quantity,
                'remaining_quantity' => $quantity,
                'received_at' => now(),
            ]);
        }

        $sameExpiry = $item->expiry_date === null
            || ($batch->expiry_date !== null && $item->expiry_date->isSameDay($batch->expiry_date));
        if (! $sameExpiry) {
            throw new BusinessException(
                "Batch {$number} of {$sku->name} already exists with expiry {$batch->expiry_date?->toDateString()}.",
                ErrorCode::BusinessRuleViolation, 422, ['batch_number' => $number],
            );
        }

        $batch->forceFill([
            'initial_quantity' => bcadd($batch->initial_quantity, $quantity, self::SCALE),
            'remaining_quantity' => bcadd($batch->remaining_quantity, $quantity, self::SCALE),
        ])->save();

        return $batch;
    }

    private function move(StockAdjustment $document, StockAdjustmentItem $item, ProductSku $sku, string $quantity, string $cost, ?StockBatch $batch, User $actor): void
    {
        StockMovement::create([
            'store_id' => $document->store_id,
            'product_sku_id' => $sku->id,
            'stock_batch_id' => $batch?->id,
            'type' => $document->type->movementType($document->reason),
            'quantity' => $quantity,
            'unit_cost' => $cost,
            'reference_type' => $document->getMorphClass(),
            'reference_id' => $document->id,
            'occurred_at' => now(),
            'created_by' => $actor->id,
        ]);
    }

    /** Locked inventory level row, created at zero on first use. */
    private function level(string $storeId, ProductSku $sku): InventoryLevel
    {
        return InventoryLevel::where('store_id', $storeId)->where('product_sku_id', $sku->id)->lockForUpdate()->first()
            // Explicit zeros: a freshly created model does not load the database defaults.
            ?? InventoryLevel::create([
                'store_id' => $storeId, 'product_sku_id' => $sku->id,
                'quantity_on_hand' => '0.0000', 'quantity_allocated' => '0.0000', 'average_cost' => '0.0000',
            ]);
    }

    private function tracksBatches(ProductSku $sku): bool
    {
        return $sku->product->track_batches || $sku->product->track_expiry;
    }

    private function trim(string $quantity): string
    {
        return rtrim(rtrim($quantity, '0'), '.') ?: '0';
    }
}
