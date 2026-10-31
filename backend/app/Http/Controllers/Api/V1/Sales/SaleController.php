<?php

namespace App\Http\Controllers\Api\V1\Sales;

use App\Domain\Cashiering\Services\Terminals;
use App\Domain\Customers\Actions\AddCustomerToSale;
use App\Domain\Sales\Actions\ProcessReturn;
use App\Domain\Sales\Actions\VoidSale;
use App\Domain\Sales\Enums\ReturnItemCondition;
use App\Domain\Sales\Enums\SaleStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Sales\PosResources;
use App\Http\Resources\V1\Sales\SaleResource;
use App\Models\Sale;
use App\Support\Audit\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Completed sales: history, receipt, reprint, void and returns.
 * Sales are never edited or deleted (docs/README.md).
 */
class SaleController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:50'],
            'status' => ['nullable', Rule::enum(SaleStatus::class)],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'device_id' => ['nullable', 'uuid'],
            'cashier_shift_id' => ['nullable', 'uuid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $sales = Sale::query()
            ->with('device', 'cashier', 'payments')
            ->withCount('items')
            ->when($filters['q'] ?? null, fn (Builder $q, $term) => $q->where(fn (Builder $q) => $q
                ->where('receipt_number', 'like', "%{$term}%")->orWhere('customer_name', 'like', "%{$term}%")))
            ->when($filters['status'] ?? null, fn (Builder $q, $status) => $q->where('status', $status))
            ->when($filters['from'] ?? null, fn (Builder $q, $from) => $q->where('business_date', '>=', $from))
            ->when($filters['to'] ?? null, fn (Builder $q, $to) => $q->where('business_date', '<=', $to))
            ->when($filters['device_id'] ?? null, fn (Builder $q, $id) => $q->where('device_id', $id))
            ->when($filters['cashier_shift_id'] ?? null, fn (Builder $q, $id) => $q->where('cashier_shift_id', $id))
            ->latest('occurred_at')
            ->paginate($filters['per_page'] ?? 25);

        return SaleResource::collection($sales);
    }

    public function show(Request $request, Sale $sale): SaleResource
    {
        $this->authorizeAny($request, ['sales.view', 'pos.access']);

        return SaleResource::receipt($sale);
    }

    /** Records the reprint in the audit log and returns the receipt. */
    public function reprint(Sale $sale, AuditLogger $audit): SaleResource
    {
        $audit->record('sale.reprinted', $sale, new: ['receipt_number' => $sale->receipt_number]);

        return SaleResource::receipt($sale);
    }

    public function void(Request $request, Sale $sale, VoidSale $void): SaleResource
    {
        $this->authorizeAny($request, ['sales.void', 'pos.access']);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:255'],
            'approval' => ['nullable', 'array'],
            'approval.login' => ['nullable', 'string', 'max:100'],
            'approval.secret' => ['nullable', 'string', 'max:100'],
        ]);

        return SaleResource::receipt($void->execute($sale, $request->user(), $data['reason'], $data['approval'] ?? null));
    }

    /** A customer forgotten at checkout: recorded beside the sale, which itself never changes. Needs customers.manage. */
    public function addCustomer(Request $request, Sale $sale, AddCustomerToSale $add): SaleResource
    {
        $this->authorizeAny($request, ['sales.view', 'pos.access']);
        $data = $request->validate([
            'customer_id' => ['required', 'uuid'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        $add->execute($request->user(), $sale, $data['customer_id'], $data['reason'] ?? null);

        return SaleResource::receipt($sale->refresh());
    }

    public function storeReturn(Request $request, Sale $sale, ProcessReturn $process, Terminals $terminals): JsonResponse
    {
        $this->authorizeAny($request, ['sales.return', 'pos.access']);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:255'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.sale_item_id' => ['required', 'uuid', 'distinct:strict'],
            'items.*.quantity' => ['required', 'decimal:0,4', 'gt:0'],
            'items.*.condition' => ['nullable', Rule::enum(ReturnItemCondition::class)],
            'refund_method' => ['required', 'string', 'max:30'],
            'refund_reference' => ['nullable', 'string', 'max:100'],
            'approval' => ['nullable', 'array'],
            'approval.login' => ['nullable', 'string', 'max:100'],
            'approval.secret' => ['nullable', 'string', 'max:100'],
        ]);

        $return = $process->execute($sale, $terminals->require($request), $request->user(), $data);

        return response()->json(['data' => PosResources::saleReturn($return)], 201);
    }

    /** @param list<string> $permissions */
    private function authorizeAny(Request $request, array $permissions): void
    {
        foreach ($permissions as $permission) {
            if ($request->user()->hasPermission($permission)) {
                return;
            }
        }
        abort(403, 'This action is unauthorized.');
    }
}
