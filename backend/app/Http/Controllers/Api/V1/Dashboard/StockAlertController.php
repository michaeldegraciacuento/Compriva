<?php

namespace App\Http\Controllers\Api\V1\Dashboard;

use App\Domain\Inventory\Queries\StockAlerts;
use App\Http\Controllers\Controller;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * Low-stock and expiring-batch alerts, used by the dashboard and the header
 * notifications. Available to anyone who can see the dashboard or inventory.
 */
class StockAlertController extends Controller
{
    public function __invoke(StockAlerts $alerts): JsonResponse
    {
        if (! Gate::any(['dashboard.view', 'inventory.view'])) {
            throw new AuthorizationException('You are not allowed to view stock alerts.');
        }

        return response()->json(['data' => $alerts->get()]);
    }
}
