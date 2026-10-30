<?php

namespace App\Domain\Inventory\Services;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Domain\Inventory\Enums\AllocationEventType;
use App\Models\Device;
use App\Models\InventoryLevel;
use App\Models\ProductSku;
use App\Models\Setting;
use App\Models\StockAllocationEvent;
use App\Models\SyncCursor;
use App\Models\TerminalStockAllocation;
use App\Models\User;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Terminal stock allocations (docs/offline-sync.md §6).
 *
 * A desktop terminal sells offline only from the stock allocated to it, so two
 * offline terminals can never sell the same units. Allocated stock is reserved
 * centrally (inventory_levels.quantity_allocated): online sales and other
 * terminals cannot take it.
 *
 *   terminal remaining = allocated − consumed − released
 *   central available  = on hand − Σ reserved
 *
 * Top-ups share stock fairly: the terminals together may hold
 * pos.allocation_share_percent (default 90%) of (unreserved stock + what they
 * still hold), split equally between syncing terminals; the rest stays central
 * for online sales. Every change is an append-only allocation event; reserved
 * quantities change only here, under the stock ledger guard.
 */
class StockAllocations
{
    private const SCALE = 4;

    /**
     * Gives the terminal its fair share of each SKU's free stock, and reports
     * where it holds more than its share (another terminal joined later): the
     * terminal releases that excess itself, through its outbox, after any
     * offline sales, so stock it already sold can never be given away.
     *
     * @param  ?list<string>  $skuIds  null = every stock-tracked SKU
     * @return array{changed: list<string>, excess: array<string, string>} allocation IDs that grew; sku_id => quantity above the share
     */
    public function topUp(Device $device, ?array $skuIds = null): array
    {
        $terminals = $this->syncingTerminals($device);
        $share = (string) max(0, min(100, (int) (Setting::whereNull('store_id')->where('group', 'pos')->where('key', 'allocation_share_percent')->value('value') ?? 90)));
        $skus = ProductSku::query()
            ->with('product', 'baseUnit')
            ->where('is_active', true)
            ->whereHas('product', fn ($q) => $q->where('is_active', true)->where('track_inventory', true))
            ->when($skuIds !== null, fn ($q) => $q->whereKey($skuIds))
            ->get();

        $changed = [];
        $excess = [];
        foreach ($skus as $sku) {
            $id = DB::transaction(function () use ($device, $sku, $terminals, $share, &$excess) {
                $level = InventoryLevel::where('store_id', $device->store_id)->where('product_sku_id', $sku->id)->lockForUpdate()->first();
                if ($level === null) {
                    return null;
                }
                $allocations = TerminalStockAllocation::where('product_sku_id', $sku->id)->whereIn('device_id', $terminals)->lockForUpdate()->get();
                $mine = $allocations->firstWhere('device_id', $device->id);

                $free = $this->positive(bcsub($level->quantity_on_hand, $level->quantity_allocated, self::SCALE));
                $held = $allocations->reduce(fn (string $sum, $a) => bcadd($sum, $this->positive($a->availableQuantity()), self::SCALE), '0');
                $pool = bcdiv(bcmul(bcadd($free, $held, self::SCALE), $share, self::SCALE), '100', self::SCALE);
                $target = $this->roundDown(bcdiv($pool, (string) count($terminals), self::SCALE), $sku->baseUnit->allows_decimal);
                $holding = $mine === null ? '0' : $this->positive($mine->availableQuantity());
                $over = $this->roundDown(bcsub($holding, $target, self::SCALE), $sku->baseUnit->allows_decimal);
                if (bccomp($over, '0', self::SCALE) > 0) {
                    $excess[$sku->id] = bcadd($over, '0', self::SCALE);
                }
                $grant = $this->minimum($free, $this->positive(bcsub($target, $holding, self::SCALE)));
                $grant = $this->roundDown($grant, $sku->baseUnit->allows_decimal);

                if (bccomp($grant, '0', self::SCALE) <= 0) {
                    return null;
                }

                return $this->allocate($device, $sku, $level, $grant, null)->id;
            });
            if ($id !== null) {
                $changed[] = $id;
            }
        }

        return ['changed' => $changed, 'excess' => $excess];
    }

    /** A manager hands a terminal a specific quantity (from free stock only). */
    public function allocateManually(Device $device, ProductSku $sku, string $quantity, User $actor): TerminalStockAllocation
    {
        return DB::transaction(function () use ($device, $sku, $quantity, $actor) {
            $level = InventoryLevel::where('store_id', $device->store_id)->where('product_sku_id', $sku->id)->lockForUpdate()->first();
            $free = $level === null ? '0' : $this->positive(bcsub($level->quantity_on_hand, $level->quantity_allocated, self::SCALE));
            if ($level === null || bccomp($quantity, $free, self::SCALE) > 0) {
                throw new BusinessException("Only {$this->trim($free)} of {$sku->name} is free to allocate.", ErrorCode::InsufficientStock, 422, ['available' => $free]);
            }

            return $this->allocate($device, $sku, $level, $quantity, $actor);
        });
    }

    /**
     * A synced sale used allocated stock. Returns how much it sold beyond the
     * terminal's remaining allocation ("0" normally).
     */
    public function consume(Device $device, ProductSku $sku, string $quantity, string $saleId, ?string $operationId): string
    {
        return StockLedger::writing(function () use ($device, $sku, $quantity, $saleId, $operationId) {
            $allocation = $this->allocationFor($device, $sku);
            $remaining = $this->positive($allocation->availableQuantity());
            $covered = $this->minimum($quantity, $remaining);

            $allocation->forceFill(['consumed_quantity' => bcadd($allocation->consumed_quantity, $quantity, self::SCALE), 'last_event_at' => now()])->save();
            $this->event($allocation, AllocationEventType::Consume, $quantity, $saleId, $operationId, null);

            if (bccomp($covered, '0', self::SCALE) > 0) {
                $level = InventoryLevel::where('store_id', $device->store_id)->where('product_sku_id', $sku->id)->lockForUpdate()->first();
                $level?->forceFill(['quantity_allocated' => $this->positive(bcsub($level->quantity_allocated, $covered, self::SCALE))])->save();
            }

            return bcsub($quantity, $covered, self::SCALE);
        });
    }

    /** A synced void put goods back on the terminal's shelf: they become its allocation again. */
    public function restore(Device $device, ProductSku $sku, string $quantity, string $saleId, ?string $operationId): void
    {
        $level = InventoryLevel::where('store_id', $device->store_id)->where('product_sku_id', $sku->id)->lockForUpdate()->first();
        if ($level !== null) {
            $this->allocate($device, $sku, $level, $quantity, null);
        }
    }

    /** The terminal gives back stock it no longer needs (sent by the terminal, after its sales). */
    public function release(Device $device, ProductSku $sku, string $quantity, ?string $operationId): TerminalStockAllocation
    {
        return DB::transaction(fn () => StockLedger::writing(function () use ($device, $sku, $quantity, $operationId) {
            $allocation = $this->allocationFor($device, $sku);
            $remaining = $this->positive($allocation->availableQuantity());
            $quantity = $this->minimum($quantity, $remaining);
            if (bccomp($quantity, '0', self::SCALE) <= 0) {
                return $allocation;
            }

            $allocation->forceFill(['released_quantity' => bcadd($allocation->released_quantity, $quantity, self::SCALE), 'last_event_at' => now()])->save();
            $this->event($allocation, AllocationEventType::Release, $quantity, null, $operationId, null);
            $level = InventoryLevel::where('store_id', $device->store_id)->where('product_sku_id', $sku->id)->lockForUpdate()->first();
            $level?->forceFill(['quantity_allocated' => $this->positive(bcsub($level->quantity_allocated, $quantity, self::SCALE))])->save();

            return $allocation;
        }));
    }

    private function allocate(Device $device, ProductSku $sku, InventoryLevel $level, string $quantity, ?User $actor): TerminalStockAllocation
    {
        return StockLedger::writing(function () use ($device, $sku, $level, $quantity, $actor) {
            $allocation = $this->allocationFor($device, $sku);
            $allocation->forceFill(['allocated_quantity' => bcadd($allocation->allocated_quantity, $quantity, self::SCALE), 'last_event_at' => now()])->save();
            $this->event($allocation, AllocationEventType::Allocate, $quantity, null, null, $actor);
            $level->forceFill(['quantity_allocated' => bcadd($level->quantity_allocated, $quantity, self::SCALE)])->save();

            return $allocation;
        });
    }

    private function allocationFor(Device $device, ProductSku $sku): TerminalStockAllocation
    {
        return TerminalStockAllocation::where('device_id', $device->id)->where('product_sku_id', $sku->id)->lockForUpdate()->first()
            ?? TerminalStockAllocation::create([
                'store_id' => $device->store_id, 'device_id' => $device->id, 'product_sku_id' => $sku->id,
                'allocated_quantity' => '0.0000', 'consumed_quantity' => '0.0000', 'released_quantity' => '0.0000',
            ]);
    }

    private function event(TerminalStockAllocation $allocation, AllocationEventType $type, string $quantity, ?string $saleId, ?string $operationId, ?User $actor): void
    {
        StockAllocationEvent::create([
            'terminal_stock_allocation_id' => $allocation->id,
            'type' => $type,
            'quantity' => $quantity,
            'sale_id' => $saleId,
            'operation_id' => $operationId,
            'created_by' => $actor?->id,
            'occurred_at' => now(),
            'created_at' => now(),
        ]);
    }

    /** Active terminals that sync (they have pulled at least once), always including this one. @return list<string> */
    private function syncingTerminals(Device $device): array
    {
        return Device::where('status', DeviceStatus::Active)
            ->whereIn('id', SyncCursor::select('device_id'))
            ->pluck('id')->push($device->id)->unique()->values()->all();
    }

    private function roundDown(string $quantity, bool $decimals): string
    {
        return bcadd($quantity, '0', $decimals ? 3 : 0);
    }

    private function positive(string $quantity): string
    {
        return bccomp($quantity, '0', self::SCALE) > 0 ? $quantity : '0';
    }

    private function minimum(string $a, string $b): string
    {
        return bccomp($a, $b, self::SCALE) <= 0 ? $a : $b;
    }

    private function trim(string $quantity): string
    {
        return rtrim(rtrim($quantity, '0'), '.') ?: '0';
    }
}
