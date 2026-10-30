<?php

namespace App\Models\Concerns;

use App\Domain\Inventory\Enums\DocumentStatus;
use App\Support\Database\ImmutableRecordException;

/**
 * For documents with a draft → posted lifecycle (goods receipts, stock
 * adjustments): once posted, stock has moved and the document is frozen.
 * Mirrors Integrity::lockWhenPosted() triggers.
 */
trait LockedWhenPosted
{
    public static function bootLockedWhenPosted(): void
    {
        $guard = function ($model, string $action) {
            if ($model->getOriginal('status') === DocumentStatus::Posted) {
                throw ImmutableRecordException::forModel($model, $action.' after posting');
            }
        };

        static::updating(fn ($model) => $guard($model, 'updated'));
        static::deleting(fn ($model) => $guard($model, 'deleted'));
    }

    public function isPosted(): bool
    {
        return $this->status === DocumentStatus::Posted;
    }
}
