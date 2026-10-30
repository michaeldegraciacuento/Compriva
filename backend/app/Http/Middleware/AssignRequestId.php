<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gives every API request a correlation ID.
 *
 * Accepts a client-supplied X-Request-Id (so terminal logs and server logs
 * can be matched) or generates one, adds it to the log context and echoes
 * it back in the response header.
 */
class AssignRequestId
{
    public const HEADER = 'X-Request-Id';

    public const ATTRIBUTE = 'request_id';

    public function handle(Request $request, Closure $next): Response
    {
        $id = self::sanitize($request->headers->get(self::HEADER)) ?? (string) Str::uuid7();

        $request->attributes->set(self::ATTRIBUTE, $id);
        Log::withContext([self::ATTRIBUTE => $id]);

        $response = $next($request);
        $response->headers->set(self::HEADER, $id);

        return $response;
    }

    private static function sanitize(?string $value): ?string
    {
        if ($value === null || ! preg_match('/^[A-Za-z0-9._-]{8,64}$/', $value)) {
            return null;
        }

        return $value;
    }
}
