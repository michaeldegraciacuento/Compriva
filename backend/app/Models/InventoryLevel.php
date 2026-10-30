<?php

namespace App\Models;

use App\Models\Concerns\GuardedByStockLedger;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Current stock of a SKU in a store: a projection of stock_movements, updated
 * by the Inventory domain in the same transaction as each movement.
 */
class InventoryLevel extends Model
{
    use GuardedByStockLedger, HasFactory, HasUuids;

    /** Changed only by StockLedger, which records a movement for each change. */
    public const LEDGER_COLUMNS = ['quantity_on_hand', 'quantity_allocated', 'average_cost'];

    protected function casts(): array
    {
        return [
            'quantity_on_hand' => 'decimal:4',
            'quantity_allocated' => 'decimal:4',
            'average_cost' => 'decimal:4',
            'last_movement_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(ProductSku::class, 'product_sku_id');
    }
}
