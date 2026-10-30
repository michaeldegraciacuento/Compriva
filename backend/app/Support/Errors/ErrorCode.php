<?php

namespace App\Support\Errors;

/**
 * Stable, machine-readable error codes returned in every API error body.
 *
 * Clients branch on these codes, never on messages. Keep this list in sync
 * with ApiErrorCode in frontend/src/types/api.ts and docs/error-handling.md.
 * Domain modules add their own codes here as they are built (e.g. INSUFFICIENT_STOCK).
 */
enum ErrorCode: string
{
    // Request / protocol
    case BadRequest = 'BAD_REQUEST';
    case ValidationFailed = 'VALIDATION_FAILED';
    case Unauthenticated = 'UNAUTHENTICATED';
    case Forbidden = 'FORBIDDEN';
    case NotFound = 'NOT_FOUND';
    case MethodNotAllowed = 'METHOD_NOT_ALLOWED';
    case Conflict = 'CONFLICT';
    case SessionExpired = 'SESSION_EXPIRED';
    case TooManyRequests = 'TOO_MANY_REQUESTS';

    // Authentication
    case InvalidCredentials = 'INVALID_CREDENTIALS';
    case AccountSuspended = 'ACCOUNT_SUSPENDED';
    case PairingCodeInvalid = 'PAIRING_CODE_INVALID';

    // Business rules (generic; modules may add specific codes)
    case BusinessRuleViolation = 'BUSINESS_RULE_VIOLATION';

    // Inventory
    case InsufficientStock = 'INSUFFICIENT_STOCK';

    // Point of sale
    case TerminalRequired = 'TERMINAL_REQUIRED';
    case ShiftRequired = 'SHIFT_REQUIRED';
    case ApprovalRequired = 'APPROVAL_REQUIRED';
    case TotalMismatch = 'TOTAL_MISMATCH';

    // Devices / synchronization
    case DeviceNotRegistered = 'DEVICE_NOT_REGISTERED';
    case DeviceRevoked = 'DEVICE_REVOKED';
    case DuplicateOperation = 'DUPLICATE_OPERATION';
    case SyncCursorInvalid = 'SYNC_CURSOR_INVALID';

    // Server
    case ServiceUnavailable = 'SERVICE_UNAVAILABLE';
    case ServerError = 'SERVER_ERROR';
}
