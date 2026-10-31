<?php

namespace App\Http\Controllers\Api\V1\Customers;

use App\Domain\Customers\Actions\SaveCustomer;
use App\Domain\Customers\Enums\CustomerType;
use App\Domain\Sales\Enums\SaleStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Customers\CustomerResources;
use App\Models\Customer;
use App\Models\Sale;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;

/**
 * Customers and their purchase history (docs/README.md).
 * Permissions per route: customers.view / customers.manage.
 */
class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'type' => ['nullable', Rule::enum(CustomerType::class)],
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
            'sort' => ['nullable', Rule::in(['name', 'recent', 'top'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $customers = $this->withPurchases(Customer::query())
            ->when($filters['q'] ?? null, fn (Builder $q, $term) => $q->where(fn (Builder $q) => $q
                ->where('name', 'like', "%{$term}%")->orWhere('code', 'like', "%{$term}%")
                ->orWhere('phone', 'like', "%{$term}%")->orWhere('email', 'like', "%{$term}%")
                ->orWhere('id_number', 'like', "%{$term}%")->orWhere('tin', 'like', "%{$term}%")))
            ->when($filters['type'] ?? null, fn (Builder $q, $type) => $q->where('type', $type))
            ->when(($filters['status'] ?? null) === 'active', fn (Builder $q) => $q->where('is_active', true))
            ->when(($filters['status'] ?? null) === 'inactive', fn (Builder $q) => $q->where('is_active', false))
            ->when(($filters['sort'] ?? 'name') === 'recent', fn (Builder $q) => $q->orderByDesc('last_purchase_at'))
            ->when(($filters['sort'] ?? 'name') === 'top', fn (Builder $q) => $q->orderByDesc('purchases_total'))
            ->orderBy('name')
            ->paginate($filters['per_page'] ?? 25);

        return $this->paginated($customers, fn (Customer $c) => CustomerResources::customer($c));
    }

    public function show(Customer $customer): JsonResponse
    {
        $customer = $this->withPurchases(Customer::query())->whereKey($customer->id)->firstOrFail();

        return response()->json(['data' => CustomerResources::customer($customer)]);
    }

    public function store(Request $request, SaveCustomer $save): JsonResponse
    {
        $customer = $save->create($this->validated($request));

        return $this->show($customer)->setStatusCode(201);
    }

    public function update(Request $request, Customer $customer, SaveCustomer $save): JsonResponse
    {
        $save->update($customer, $this->validated($request, $customer));

        return $this->show($customer);
    }

    /** Purchase history, newest first (voided sales included and marked). */
    public function sales(Request $request, Customer $customer): JsonResponse
    {
        $filters = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        $sales = Sale::query()->ofCustomer($customer->id)->with(['device:id,code', 'cashier:id,name', 'customerLink'])->withCount('items')
            ->orderByDesc('occurred_at')->orderByDesc('id') // UUIDv7: same-second sales stay in order
            ->paginate($filters['per_page'] ?? 20);

        return $this->paginated($sales, fn ($sale) => CustomerResources::purchase($sale));
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?Customer $customer = null): array
    {
        $data = $request->validate([
            'code' => ['nullable', 'string', 'max:30', Rule::unique('customers', 'code')->ignore($customer?->id)],
            'name' => [$customer ? 'sometimes' : 'required', 'string', 'max:255'],
            'type' => [$customer ? 'sometimes' : 'nullable', Rule::enum(CustomerType::class)],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'tin' => ['nullable', 'string', 'max:20'],
            'id_number' => ['nullable', 'string', 'max:50'],
            'birth_date' => ['nullable', 'date', 'before:today', 'after:1900-01-01'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        if (! $customer && ($data['code'] ?? null) === null) {
            unset($data['code']);
        }
        if (array_key_exists('type', $data) && $data['type'] === null) {
            unset($data['type']);
        }

        return $data;
    }

    /** Completed sales chosen at checkout or added later (SaleCustomerLink). */
    private function withPurchases(Builder $query): Builder
    {
        $completed = fn (string $aggregate) => Sale::query()->ofCustomer('customers.id', isColumn: true)
            ->where('sales.status', SaleStatus::Completed)->selectRaw($aggregate);

        return $query->select('customers.*')
            ->selectSub($completed('count(*)'), 'purchases_count')
            ->selectSub($completed('sum(sales.grand_total)'), 'purchases_total')
            ->selectSub($completed('max(sales.occurred_at)'), 'last_purchase_at');
    }

    private function paginated(LengthAwarePaginator $page, callable $map): JsonResponse
    {
        return response()->json([
            'data' => collect($page->items())->map($map)->values(),
            'meta' => [
                'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(),
                'total' => $page->total(), 'from' => $page->firstItem(), 'to' => $page->lastItem(),
            ],
        ]);
    }
}
