<?php

namespace App\Support\Database;

use LogicException;

/**
 * Raised when code tries to change or delete a record that must never change
 * (ledgers, completed sales, posted documents). The database enforces the same
 * rules with triggers; this exception catches the mistake earlier, in PHP.
 */
class ImmutableRecordException extends LogicException
{
    public static function forModel(object $model, string $action): self
    {
        return new self(sprintf('%s records cannot be %s.', class_basename($model), $action));
    }
}
