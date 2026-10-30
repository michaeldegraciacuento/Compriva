<?php

namespace App\Support\Errors;

use App\Http\Middleware\AssignRequestId;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Renders every exception raised under /api as the standard error envelope:
 *
 *   { "error": { "code", "message", "details", "request_id" } }
 *
 * Laravel converts ModelNotFound/Authorization/TokenMismatch exceptions into
 * HTTP exceptions before render callbacks run, so they arrive here as
 * 404/403/419 HttpExceptions.
 */
class ApiExceptionRenderer
{
    public function __invoke(Throwable $e, Request $request): ?JsonResponse
    {
        if (! $request->is('api/*')) {
            return null;
        }

        [$status, $code, $message, $details] = $this->describe($e);

        $response = response()->json([
            'error' => [
                'code' => $code->value,
                'message' => $message,
                'details' => (object) $details,
                'request_id' => $request->attributes->get(AssignRequestId::ATTRIBUTE),
            ],
        ], $status);

        if ($e instanceof HttpExceptionInterface) {
            $response->withHeaders($e->getHeaders());
        }

        return $response;
    }

    /**
     * @return array{0: int, 1: ErrorCode, 2: string, 3: array<string, mixed>}
     */
    private function describe(Throwable $e): array
    {
        return match (true) {
            $e instanceof BusinessException => [$e->status, $e->errorCode, $e->getMessage(), $e->details],
            $e instanceof ValidationException => [
                $e->status,
                ErrorCode::ValidationFailed,
                'The given data was invalid.',
                ['fields' => $e->errors()],
            ],
            $e instanceof AuthenticationException => [401, ErrorCode::Unauthenticated, 'Authentication is required.', []],
            $e instanceof HttpExceptionInterface => $this->describeHttp($e),
            default => [500, ErrorCode::ServerError, $this->serverErrorMessage($e), []],
        };
    }

    /**
     * @return array{0: int, 1: ErrorCode, 2: string, 3: array<string, mixed>}
     */
    private function describeHttp(HttpExceptionInterface $e): array
    {
        $status = $e->getStatusCode();

        [$code, $default] = match ($status) {
            400 => [ErrorCode::BadRequest, 'The request is invalid.'],
            401 => [ErrorCode::Unauthenticated, 'Authentication is required.'],
            403 => [ErrorCode::Forbidden, 'You are not allowed to perform this action.'],
            404 => [ErrorCode::NotFound, 'The requested resource was not found.'],
            405 => [ErrorCode::MethodNotAllowed, 'This method is not allowed for this endpoint.'],
            409 => [ErrorCode::Conflict, 'The request conflicts with the current state.'],
            419 => [ErrorCode::SessionExpired, 'Your session has expired. Please sign in again.'],
            429 => [ErrorCode::TooManyRequests, 'Too many requests. Please slow down.'],
            503 => [ErrorCode::ServiceUnavailable, 'The service is temporarily unavailable.'],
            default => $status >= 500
                ? [ErrorCode::ServerError, 'An unexpected error occurred.']
                : [ErrorCode::BadRequest, 'The request could not be processed.'],
        };

        // Framework messages for 404/405 leak internals (model class names, routes).
        $message = in_array($status, [404, 405], true) || $e->getMessage() === ''
            ? $default
            : $e->getMessage();

        return [$status, $code, $message, []];
    }

    private function serverErrorMessage(Throwable $e): string
    {
        return config('app.debug') ? $e->getMessage() : 'An unexpected error occurred.';
    }
}
