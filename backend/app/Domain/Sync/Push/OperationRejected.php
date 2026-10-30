<?php

namespace App\Domain\Sync\Push;

use RuntimeException;

/** An operation that can never be applied (invalid, forged, unauthorized). The terminal keeps it for review. */
class OperationRejected extends RuntimeException
{
    public function __construct(string $message, public readonly string $errorCode = 'INVALID_OPERATION')
    {
        parent::__construct($message);
    }
}
