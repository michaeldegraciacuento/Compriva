<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One `unit` of a SKU equals `factor` base units (1 case = 12.000000 pcs). */
class UnitConversion extends Model
{
    use HasFactory, HasUuids;

    protected function casts(): array
    {
        return [
            'factor' => 'decimal:6',
            'is_purchase_unit' => 'boolean',
            'is_sales_unit' => 'boolean',
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
}
