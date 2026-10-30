<?php

namespace App\Support\Errors;

use RuntimeException;

/**
 * Base class for expected, user-facing failures raised by domain code
 * (e.g. insufficient stock, shift already closed).
 *
 * Domain modules extend this class; the API renders it as the standard
 * error envelope with the given code, HTTP status and details.
 */
class BusinessException extends RuntimeException
{
    /**
     * @param  array<string, mixed>  $details
     */
    public function __construct(
        string $message,
        public readonly ErrorCode $errorCode = ErrorCode::BusinessRuleViolation,
        public readonly int $status = 422,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
