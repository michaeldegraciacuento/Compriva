<?php

namespace App\Models;

use App\Domain\Catalog\Enums\UnitType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Unit extends Model
{
    use HasFactory, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => UnitType::class,
            'allows_decimal' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
