<?php

namespace App\Http\Controllers\Api\V1\System;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Connectivity probe used by the web app and desktop terminals.
 *
 * Public and cheap: terminals call it to decide whether the cloud API is
 * reachable before syncing. Returns 503 when the database is unavailable.
 */
class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('select 1');
            $database = 'ok';
        } catch (Throwable $e) {
            report($e);
            $database = 'unavailable';
        }

        $healthy = $database === 'ok';

        return response()->json([
            'data' => [
                'status' => $healthy ? 'ok' : 'degraded',
                'api_version' => config('compriva.api.version'),
                'server_time' => now()->utc()->toIso8601ZuluString(),
                'timezone' => config('compriva.timezone'),
                'currency' => config('compriva.currency'),
                'checks' => ['database' => $database],
            ],
        ], $healthy ? 200 : 503);
    }
}
