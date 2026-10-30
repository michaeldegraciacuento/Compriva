<?php

namespace App\Models;

use App\Domain\Sales\Enums\DiscountKind;
use App\Domain\Sales\Enums\DiscountScope;
use App\Domain\Sales\Enums\DiscountType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Discount extends Model
{
    use HasFactory, HasUuids, SoftDeletes;

    protected function casts(): array
    {
        return [
            'kind' => DiscountKind::class,
            'type' => DiscountType::class,
            'scope' => DiscountScope::class,
            'value' => 'decimal:4',
            'min_purchase_amount' => 'decimal:4',
            'max_discount_amount' => 'decimal:4',
            'is_vat_exempt' => 'boolean',
            'requires_customer_id' => 'boolean',
            'requires_approval' => 'boolean',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }
}
