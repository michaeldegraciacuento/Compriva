<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Key/value setting, global (store_id NULL) or per store. `value` is JSON, so
 * it can hold strings, numbers, booleans or structures. `scope` is generated.
 */
class Setting extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return ['value' => 'json'];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
