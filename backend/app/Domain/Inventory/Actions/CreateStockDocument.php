<?php

namespace App\Domain\Inventory\Actions;

use App\Domain\Inventory\Enums\AdjustmentReason;
use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Inventory\Enums\StockDocumentType;
use App\Domain\Inventory\Services\StockLedger;
use App\Models\InventoryLevel;
use App\Models\ProductSku;
use App\Models\StockAdjustment;
use App\Models\StockBatch;
use App\Models\Store;
use App\Models\Unit;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Creates a stock-in, stock-out or count document.
 *
 * Users who may approve (`inventory.approve`) post immediately; everyone else
 * creates a draft that a manager approves (ReviewStockDocument). Lines are
 * validated against the catalog here (units, decimals, batches, expiry);
 * quantities are checked again when posting, under row locks.
 */
class CreateStockDocument
{
    private const SCALE = 4;

    public function __construct(
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  array{reason: string, reference?: ?string, notes?: ?string, lines: list<array<string, mixed>>}  $data
     */
    public function execute(User $actor, StockDocumentType $type, array $data): StockAdjustment
    {
        $reason = AdjustmentReason::from($data['reason']);
        if (! in_array($reason, $type->reasons(), true)) {
            throw ValidationException::withMessages(['reason' => "\"{$reason->label()}\" is not a reason for this document."]);
        }

        return DB::transaction(function () use ($actor, $type, $reason, $data) {
            $store = Store::query()->orderBy('created_at')->firstOrFail();

            $document = StockAdjustment::create([
                'store_id' => $store->id,
                'adjustment_number' => $this->nextNumber($type),
                'type' => $type,
                'reason' => $reason,
                'reference' => $data['reference'] ?? null,
                'notes' => $data['notes'] ?? null,
                'status' => DocumentStatus::Draft,
                'created_by' => $actor->id,
            ]);

            foreach ($data['lines'] as $index => $line) {
                $document->items()->create($this->line($type, $store, $line, "lines.{$index}"));
            }

            $this->audit->record('stock_document.created', $document, new: [
                'number' => $document->adjustment_number, 'type' => $type->value, 'reason' => $reason->value, 'lines' => count($data['lines']),
            ]);

            return $actor->hasPermission('inventory.approve') ? $this->ledger->post($document, $actor) : $document;
        });
    }

    /** @return array<string, mixed> item attributes */
    private function line(StockDocumentType $type, Store $store, array $line, string $path): array
    {
        $sku = ProductSku::with('product', 'baseUnit', 'unitConversions')->find($line['product_sku_id'] ?? null);
        if ($sku === null) {
            throw ValidationException::withMessages(["{$path}.product_sku_id" => 'Choose a product.']);
        }

        $product = $sku->product;
        $tracksBatches = $product->track_batches || $product->track_expiry;
        $level = InventoryLevel::where('store_id', $store->id)->where('product_sku_id', $sku->id)->first();
        $onHand = $level?->quantity_on_hand ?? '0.0000';

        if ($type === StockDocumentType::Adjustment) {
            $batch = $this->batch($line, $sku, $path);
            if ($batch === null && $tracksBatches) {
                throw ValidationException::withMessages(["{$path}.stock_batch_id" => "{$sku->name} is tracked by batch: choose the batch you counted."]);
            }
            $counted = $this->decimal($line['counted_quantity'] ?? null, "{$path}.counted_quantity", $sku->baseUnit, allowZero: true);
            $system = $batch?->remaining_quantity ?? $onHand;
            $difference = bcsub($counted, $system, self::SCALE);
            if (bccomp($difference, '0', self::SCALE) === 0) {
                throw ValidationException::withMessages(["{$path}.counted_quantity" => 'The count matches the system quantity; remove this line.']);
            }

            return [
                'product_sku_id' => $sku->id,
                'stock_batch_id' => $batch?->id,
                'unit_id' => $sku->base_unit_id,
                'system_quantity' => $system,
                'counted_quantity' => $counted,
                'quantity_change' => $difference,
                'unit_cost' => $batch?->unit_cost ?? $level?->average_cost ?? $sku->cost_price,
                'notes' => $line['notes'] ?? null,
            ];
        }

        [$unit, $factor] = $this->unit($line['unit_id'] ?? null, $sku, "{$path}.unit_id");
        $quantity = $this->decimal($line['quantity'] ?? null, "{$path}.quantity", $unit);
        $base = bcmul($quantity, $factor, self::SCALE);

        if ($type === StockDocumentType::StockIn) {
            $unitCost = $this->decimal($line['unit_cost'] ?? null, "{$path}.unit_cost", null, allowZero: true);
            $expiry = $line['expiry_date'] ?? null;
            if ($product->track_expiry && empty($expiry)) {
                throw ValidationException::withMessages(["{$path}.expiry_date" => "{$product->name} tracks expiry: enter the expiry date."]);
            }
            if ($product->track_batches && empty($line['batch_number'])) {
                throw ValidationException::withMessages(["{$path}.batch_number" => "{$product->name} tracks batches: enter the batch or lot number."]);
            }

            return [
                'product_sku_id' => $sku->id,
                'unit_id' => $unit->id,
                'quantity' => $quantity,
                'conversion_factor' => $factor,
                'system_quantity' => $onHand,
                'quantity_change' => $base,
                'unit_cost' => bcdiv($unitCost, $factor, self::SCALE), // per base unit
                'batch_number' => $line['batch_number'] ?? null,
                'expiry_date' => $expiry ?: null,
                'notes' => $line['notes'] ?? null,
            ];
        }

        // Stock out
        $batch = $this->batch($line, $sku, $path);

        return [
            'product_sku_id' => $sku->id,
            'stock_batch_id' => $batch?->id,
            'unit_id' => $unit->id,
            'quantity' => $quantity,
            'conversion_factor' => $factor,
            'system_quantity' => $onHand,
            'quantity_change' => bcmul($base, '-1', self::SCALE),
            'unit_cost' => $level?->average_cost ?? $sku->cost_price,
            'notes' => $line['notes'] ?? null,
        ];
    }

    /** The unit must be the SKU's base unit or one of its conversions. @return array{0: Unit, 1: string} */
    private function unit(?string $unitId, ProductSku $sku, string $field): array
    {
        if ($unitId === null || $unitId === $sku->base_unit_id) {
            return [$sku->baseUnit, '1.000000'];
        }

        $conversion = $sku->unitConversions->firstWhere('unit_id', $unitId);
        if ($conversion === null) {
            throw ValidationException::withMessages([$field => "{$sku->name} is not sold or bought in this unit."]);
        }

        return [Unit::findOrFail($unitId), $conversion->factor];
    }

    private function batch(array $line, ProductSku $sku, string $path): ?StockBatch
    {
        if (empty($line['stock_batch_id'])) {
            return null;
        }

        return StockBatch::whereKey($line['stock_batch_id'])->where('product_sku_id', $sku->id)->first()
            ?? throw ValidationException::withMessages(["{$path}.stock_batch_id" => 'This batch does not belong to the product.']);
    }

    /** Positive decimal with at most 4 places; whole numbers only for count units. */
    private function decimal(mixed $value, string $field, ?Unit $unit, bool $allowZero = false): string
    {
        $text = is_numeric($value) ? (string) $value : '';
        if (! preg_match('/^\d{1,11}(\.\d{1,4})?$/', $text)) {
            throw ValidationException::withMessages([$field => 'Enter a number with up to 4 decimal places.']);
        }
        if ($unit !== null && ! $unit->allows_decimal && str_contains(rtrim(rtrim($text, '0'), '.'), '.')) {
            throw ValidationException::withMessages([$field => "Whole numbers only for {$unit->name}."]);
        }
        $normalized = bcadd($text, '0', self::SCALE);
        if (! $allowZero && bccomp($normalized, '0', self::SCALE) <= 0) {
            throw ValidationException::withMessages([$field => 'Enter a quantity greater than zero.']);
        }

        return $normalized;
    }

    private function nextNumber(StockDocumentType $type): string
    {
        $prefix = $type->prefix();
        $last = StockAdjustment::where('adjustment_number', 'like', "{$prefix}-%")
            ->orderByDesc('adjustment_number')
            ->lockForUpdate()
            ->value('adjustment_number');

        return sprintf('%s-%06d', $prefix, $last ? (int) substr($last, strlen($prefix) + 1) + 1 : 1);
    }
}
