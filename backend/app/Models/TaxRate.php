<?php

namespace App\Models;

use App\Domain\Settings\Enums\TaxType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Tax treatment; `rate` is a percentage (12.0000 = 12%). */
class TaxRate extends Model
{
    use HasFactory, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => TaxType::class,
            'rate' => 'decimal:4',
            'is_inclusive' => 'boolean',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }
}
