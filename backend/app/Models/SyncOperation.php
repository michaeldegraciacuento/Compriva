<?php

namespace App\Models;

use App\Domain\Sync\Enums\SyncOperationStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An operation pushed by a terminal. The primary key is the terminal's
 * operation_id, so receiving the same operation twice is detected by key.
 */
class SyncOperation extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected function casts(): array
    {
        return [
            'local_seq' => 'integer',
            'schema_version' => 'integer',
            'payload' => 'array',
            'status' => SyncOperationStatus::class,
            'result' => 'array',
            'occurred_at' => 'datetime',
            'received_at' => 'datetime',
            'processed_at' => 'datetime',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
