<?php

namespace App\Models;

use App\Models\Concerns\GuardedByStockLedger;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A received lot of a SKU, with its own cost and expiry date (FEFO). */
class StockBatch extends Model
{
    use GuardedByStockLedger, HasFactory, HasUuids;

    /** Changed only by StockLedger, which records a movement for each change. */
    public const LEDGER_COLUMNS = ['initial_quantity', 'remaining_quantity'];

    protected function casts(): array
    {
        return [
            'expiry_date' => 'date',
            'unit_cost' => 'decimal:4',
            'initial_quantity' => 'decimal:4',
            'remaining_quantity' => 'decimal:4',
            'received_at' => 'datetime',
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

    public function goodsReceiptItem(): BelongsTo
    {
        return $this->belongsTo(GoodsReceiptItem::class);
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }
}
