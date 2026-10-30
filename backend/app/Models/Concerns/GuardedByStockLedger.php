<?php

namespace App\Models\Concerns;

use App\Domain\Inventory\Services\StockLedger;
use App\Support\Database\ImmutableRecordException;

/**
 * "Never update inventory silently": stock quantities (and the costs derived
 * from them) may only change inside StockLedger, which records a stock
 * movement for every change. Any other code path that edits them fails.
 *
 * Models declare the guarded columns in LEDGER_COLUMNS.
 */
trait GuardedByStockLedger
{
    public static function bootGuardedByStockLedger(): void
    {
        static::updating(function ($model) {
            if (! StockLedger::isWriting() && $model->isDirty(static::LEDGER_COLUMNS)) {
                throw new ImmutableRecordException(sprintf(
                    '%s quantities change only through the stock ledger (stock-in, stock-out or adjustment).',
                    class_basename($model),
                ));
            }
        });
    }
}
