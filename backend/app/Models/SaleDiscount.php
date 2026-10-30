<?php

namespace App\Models;

use App\Domain\Sales\Enums\DiscountKind;
use App\Domain\Sales\Enums\DiscountType;
use App\Models\Concerns\AppendOnly;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A discount applied to a sale (or one of its lines), with a snapshot of its definition. */
class SaleDiscount extends Model
{
    use AppendOnly, HasFactory, HasUuids;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'kind' => DiscountKind::class,
            'type' => DiscountType::class,
            'value' => 'decimal:4',
            'amount' => 'decimal:4',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function saleItem(): BelongsTo
    {
        return $this->belongsTo(SaleItem::class);
    }

    public function discount(): BelongsTo
    {
        return $this->belongsTo(Discount::class);
    }
}
