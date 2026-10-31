<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Stock a terminal may sell offline (docs/README.md).
 * available = allocated − consumed − released; the ledger is in events().
 */
class TerminalStockAllocation extends Model
{
    use HasFactory, HasUuids;

    protected function casts(): array
    {
        return [
            'allocated_quantity' => 'decimal:4',
            'consumed_quantity' => 'decimal:4',
            'released_quantity' => 'decimal:4',
            'last_event_at' => 'datetime',
        ];
    }

    /** Remaining sellable quantity as a decimal string (may be negative after over-allocation). */
    public function availableQuantity(): string
    {
        return bcsub(bcsub($this->allocated_quantity, $this->consumed_quantity, 4), $this->released_quantity, 4);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(ProductSku::class, 'product_sku_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(StockAllocationEvent::class);
    }
}
