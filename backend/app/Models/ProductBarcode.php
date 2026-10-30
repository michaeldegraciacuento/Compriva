<?php

namespace App\Models;

use App\Domain\Catalog\Enums\BarcodeType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductBarcode extends Model
{
    use HasFactory, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => BarcodeType::class,
            'is_primary' => 'boolean',
        ];
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(ProductSku::class, 'product_sku_id');
    }

    /** NULL means the SKU's base unit. */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }
}
