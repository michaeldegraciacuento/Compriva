<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** How far a terminal has pulled a sync stream (last sync_changes.id applied). */
class SyncCursor extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'last_pulled_at' => 'datetime',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
