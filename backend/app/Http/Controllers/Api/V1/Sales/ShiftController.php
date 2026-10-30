<?php

namespace App\Http\Controllers\Api\V1\Sales;

use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Cashiering\Queries\ShiftSummary;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Sales\PosResources;
use App\Models\CashierShift;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Shift history for managers: opening cash, cash in/out, expected vs counted cash and variance. */
class ShiftController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::enum(ShiftStatus::class)],
            'cashier_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $page = CashierShift::query()
            ->with('cashier', 'device', 'closer', 'cashMovements.performer')
            ->withCount(['sales as sales_count' => fn (Builder $q) => $q->where('status', 'completed')])
            ->withSum(['sales as sales_total' => fn (Builder $q) => $q->where('status', 'completed')], 'grand_total')
            ->when($filters['status'] ?? null, fn (Builder $q, $status) => $q->where('status', $status))
            ->when($filters['cashier_id'] ?? null, fn (Builder $q, $id) => $q->where('cashier_id', $id))
            ->when($filters['from'] ?? null, fn (Builder $q, $from) => $q->whereDate('opened_at', '>=', $from))
            ->when($filters['to'] ?? null, fn (Builder $q, $to) => $q->whereDate('opened_at', '<=', $to))
            ->latest('opened_at')
            ->paginate($filters['per_page'] ?? 25);

        return response()->json([
            'data' => collect($page->items())->map(fn (CashierShift $shift) => PosResources::shift($shift) + [
                'sales_count' => (int) $shift->sales_count,
                'sales_total' => bcadd((string) ($shift->sales_total ?? '0'), '0', 4),
            ])->values(),
            'meta' => [
                'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(),
                'total' => $page->total(), 'from' => $page->firstItem(), 'to' => $page->lastItem(),
            ],
        ]);
    }

    public function show(CashierShift $shift, ShiftSummary $summary): JsonResponse
    {
        return response()->json(['data' => PosResources::shift($shift, $summary->for($shift))]);
    }
}
