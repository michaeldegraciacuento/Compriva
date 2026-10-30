<?php

namespace App\Models;

use App\Domain\Catalog\Enums\PriceTier;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Effective-dated price history. A price change closes the current row
 * (effective_to) and inserts a new one; old prices are never overwritten.
 */
class ProductPrice extends Model
{
    use HasFactory, HasUuids;

    protected function casts(): array
    {
        return [
            'tier' => PriceTier::class,
            'price' => 'decimal:4',
            'effective_from' => 'datetime',
            'effective_to' => 'datetime',
        ];
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(ProductSku::class, 'product_sku_id');
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    /** Prices in effect at the given moment (default: now). */
    public function scopeEffectiveAt(Builder $query, ?Carbon $at = null): void
    {
        $at ??= now();

        $query->where('effective_from', '<=', $at)
            ->where(fn (Builder $q) => $q->whereNull('effective_to')->orWhere('effective_to', '>', $at));
    }
}
