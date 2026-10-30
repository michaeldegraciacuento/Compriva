<?php

namespace App\Models\Concerns;

use App\Support\Database\ImmutableRecordException;

/**
 * For ledger-style tables (stock movements, payments, audit logs, ...): rows
 * can be inserted but never updated or deleted. Corrections are new rows.
 * Mirrors the database triggers created by App\Support\Database\Integrity.
 */
trait AppendOnly
{
    public static function bootAppendOnly(): void
    {
        static::updating(fn ($model) => throw ImmutableRecordException::forModel($model, 'updated'));
        static::deleting(fn ($model) => throw ImmutableRecordException::forModel($model, 'deleted'));
    }
}
