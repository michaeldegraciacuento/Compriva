<?php

namespace App\Models;

use App\Domain\Sync\Enums\SyncChangeOperation;
use Illuminate\Database\Eloquent\Model;

/**
 * Change log entry that terminals pull. The auto-increment id is the cursor;
 * `entity` uses the MorphMap aliases.
 */
class SyncChange extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'operation' => SyncChangeOperation::class,
            'changed_at' => 'datetime',
        ];
    }
}
