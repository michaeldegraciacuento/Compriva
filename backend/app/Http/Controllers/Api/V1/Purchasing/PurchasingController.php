<?php

namespace App\Http\Controllers\Api\V1\Purchasing;

use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Purchasing\Actions\ManagePurchaseOrders;
use App\Domain\Purchasing\Actions\ReceiveGoods;
use App\Domain\Purchasing\Enums\PurchaseOrderStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Purchasing\PurchasingResources;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\ProductSku;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Support\Audit\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;

/**
 * Suppliers, purchase orders, goods receipts (partial deliveries) and purchase
 * cost history (docs/README.md). Permissions per route:
 * purchasing.view / manage / approve / receive.
 */
class PurchasingController extends Controller
{
    // --- Suppliers ---------------------------------------------------------------

    public function suppliers(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        $suppliers = Supplier::query()
            ->withCount(['purchaseOrders as open_orders_count' => fn (Builder $q) => $q->whereIn('status', [PurchaseOrderStatus::Ordered, PurchaseOrderStatus::PartiallyReceived])])
            ->withSum(['goodsReceipts as purchased_total' => fn (Builder $q) => $q->where('status', DocumentStatus::Posted)], 'total_cost')
            ->withMax('goodsReceipts as last_received_at', 'received_at')
            ->when($filters['q'] ?? null, fn (Builder $q, $term) => $q->where(fn (Builder $q) => $q
                ->where('name', 'like', "%{$term}%")->orWhere('code', 'like', "%{$term}%")->orWhere('contact_person', 'like', "%{$term}%")))
            ->when(($filters['status'] ?? null) === 'active', fn (Builder $q) => $q->where('is_active', true))
            ->when(($filters['status'] ?? null) === 'inactive', fn (Builder $q) => $q->where('is_active', false))
            ->orderBy('name')
            ->paginate($filters['per_page'] ?? 25);

        return $this->paginated($suppliers, fn (Supplier $s) => PurchasingResources::supplier($s));
    }

    public function storeSupplier(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $this->validateSupplier($request);
        $data['code'] ??= $this->nextSupplierCode();
        $supplier = Supplier::create($data);
        $audit->record('supplier.created', $supplier, new: ['code' => $supplier->code, 'name' => $supplier->name]);

        return response()->json(['data' => PurchasingResources::supplier($supplier)], 201);
    }

    public function updateSupplier(Request $request, Supplier $supplier, AuditLogger $audit): JsonResponse
    {
        $data = $this->validateSupplier($request, $supplier);
        $old = $supplier->only(array_keys($data));
        $supplier->update($data);
        $audit->record('supplier.updated', $supplier, $old, $data);

        return response()->json(['data' => PurchasingResources::supplier($supplier)]);
    }

    /** @return array<string, mixed> */
    private function validateSupplier(Request $request, ?Supplier $supplier = null): array
    {
        return $request->validate([
            'code' => ['nullable', 'string', 'max:30', Rule::unique('suppliers', 'code')->ignore($supplier?->id)],
            'name' => [$supplier ? 'sometimes' : 'required', 'string', 'max:255'],
            'contact_person' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'tin' => ['nullable', 'string', 'max:20'],
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function nextSupplierCode(): string
    {
        $max = Supplier::withTrashed()->where('code', 'like', 'SUP-%')->pluck('code')
            ->map(fn (string $code) => preg_match('/^SUP-(\d+)$/', $code, $m) ? (int) $m[1] : 0)->max() ?? 0;

        return sprintf('SUP-%04d', $max + 1);
    }

    // --- Purchase orders -----------------------------------------------------------

    public function orders(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:50'],
            'status' => ['nullable', Rule::enum(PurchaseOrderStatus::class)],
            'supplier_id' => ['nullable', 'uuid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $orders = PurchaseOrder::query()
            ->with('supplier', 'creator')
            ->withCount('items')
            ->when($filters['q'] ?? null, fn (Builder $q, $term) => $q->where('po_number', 'like', "%{$term}%"))
            ->when($filters['status'] ?? null, fn (Builder $q, $status) => $q->where('status', $status))
            ->when($filters['supplier_id'] ?? null, fn (Builder $q, $id) => $q->where('supplier_id', $id))
            ->latest()
            ->paginate($filters['per_page'] ?? 25);

        return $this->paginated($orders, fn (PurchaseOrder $o) => PurchasingResources::order($o));
    }

    public function showOrder(PurchaseOrder $order): JsonResponse
    {
        return $this->orderResponse($order);
    }

    public function storeOrder(Request $request, ManagePurchaseOrders $manage): JsonResponse
    {
        $order = $manage->create($request->user(), $this->validateOrder($request));

        return $this->orderResponse($order, 201);
    }

    public function updateOrder(Request $request, PurchaseOrder $order, ManagePurchaseOrders $manage): JsonResponse
    {
        return $this->orderResponse($manage->update($order, $this->validateOrder($request)));
    }

    public function approveOrder(Request $request, PurchaseOrder $order, ManagePurchaseOrders $manage): JsonResponse
    {
        return $this->orderResponse($manage->approve($order, $request->user()));
    }

    public function cancelOrder(Request $request, PurchaseOrder $order, ManagePurchaseOrders $manage): JsonResponse
    {
        $reason = $request->validate(['reason' => ['nullable', 'string', 'max:255']])['reason'] ?? null;

        return $this->orderResponse($manage->cancel($order, $reason));
    }

    /** @return array<string, mixed> */
    private function validateOrder(Request $request): array
    {
        return $request->validate([
            'supplier_id' => ['required', 'uuid'],
            'order_date' => ['nullable', 'date_format:Y-m-d'],
            'expected_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:order_date'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.sku_id' => ['required', 'uuid'],
            'items.*.unit_id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'decimal:0,4', 'gt:0', 'max:999999'],
            'items.*.unit_cost' => ['required', 'decimal:0,4', 'min:0', 'max:9999999'],
        ], ['items.*.quantity.gt' => 'Enter a quantity greater than zero.']);
    }

    private function orderResponse(PurchaseOrder $order, int $status = 200): JsonResponse
    {
        $order->load('supplier', 'creator', 'approver', 'items.sku.product', 'items.unit', 'goodsReceipts.receiver');

        return response()->json(['data' => PurchasingResources::order($order, true)], $status);
    }

    // --- Receiving -----------------------------------------------------------------

    public function receive(Request $request, PurchaseOrder $order, ReceiveGoods $receive): JsonResponse
    {
        $data = $request->validate([
            'supplier_reference' => ['nullable', 'string', 'max:50'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.purchase_order_item_id' => ['required', 'uuid', 'distinct:strict'],
            'lines.*.quantity' => ['required', 'decimal:0,4', 'gt:0'],
            'lines.*.unit_cost' => ['nullable', 'decimal:0,4', 'min:0', 'max:9999999'],
            'lines.*.batch_number' => ['nullable', 'string', 'max:50'],
            'lines.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
        ]);

        $receipt = $receive->execute($order, $request->user(), $data);

        return response()->json(['data' => PurchasingResources::receipt($receipt->load('supplier', 'purchaseOrder', 'receiver', 'items.sku', 'items.unit'), true)], 201);
    }

    /** Purchase history: every delivery, newest first. */
    public function receipts(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:50'],
            'supplier_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $receipts = GoodsReceipt::query()
            ->with('supplier', 'purchaseOrder', 'receiver')
            ->where('status', DocumentStatus::Posted)
            ->when($filters['q'] ?? null, fn (Builder $q, $term) => $q->where(fn (Builder $q) => $q
                ->where('receipt_number', 'like', "%{$term}%")->orWhere('supplier_reference', 'like', "%{$term}%")))
            ->when($filters['supplier_id'] ?? null, fn (Builder $q, $id) => $q->where('supplier_id', $id))
            ->when($filters['from'] ?? null, fn (Builder $q, $from) => $q->whereDate('received_at', '>=', $from))
            ->when($filters['to'] ?? null, fn (Builder $q, $to) => $q->whereDate('received_at', '<=', $to))
            ->latest('received_at')
            ->paginate($filters['per_page'] ?? 25);

        return $this->paginated($receipts, fn (GoodsReceipt $r) => PurchasingResources::receipt($r));
    }

    public function showReceipt(GoodsReceipt $receipt): JsonResponse
    {
        return response()->json(['data' => PurchasingResources::receipt($receipt->load('supplier', 'purchaseOrder', 'receiver', 'items.sku', 'items.unit'), true)]);
    }

    /** Cost tracking: what each delivery of a SKU cost, per base unit, with the current costs. */
    public function costHistory(ProductSku $sku): JsonResponse
    {
        $sku->load('baseUnit', 'inventoryLevels');
        $rows = GoodsReceiptItem::query()
            ->with('goodsReceipt.supplier', 'unit', 'purchaseOrderItem')
            ->where('product_sku_id', $sku->id)
            ->whereHas('goodsReceipt', fn (Builder $q) => $q->where('status', DocumentStatus::Posted))
            ->orderByDesc('id') // UUIDv7: newest first, deterministic within the same second
            ->limit(100)
            ->get();

        return response()->json(['data' => [
            'sku' => ['id' => $sku->id, 'code' => $sku->code, 'name' => $sku->name, 'base_unit' => $sku->baseUnit->code],
            'last_cost' => $sku->cost_price,
            'average_cost' => $sku->inventoryLevels->first()?->average_cost,
            'history' => $rows->map(fn (GoodsReceiptItem $item) => [
                'receipt_id' => $item->goods_receipt_id,
                'receipt_number' => $item->goodsReceipt->receipt_number,
                'received_at' => $item->goodsReceipt->received_at->toIso8601ZuluString(),
                'supplier' => $item->goodsReceipt->supplier->name,
                'quantity' => $item->quantity,
                'unit' => $item->unit->code,
                'unit_cost' => $item->unit_cost,
                'ordered_unit_cost' => $item->purchaseOrderItem?->unit_cost,
                'cost_per_base_unit' => bcdiv($item->unit_cost, $item->conversion_factor, 4),
            ])->values(),
        ]]);
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
