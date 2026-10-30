<?php

namespace App\Http\Controllers\Api\V1\Inventory;

use App\Domain\Inventory\Actions\CreateStockDocument;
use App\Domain\Inventory\Actions\ReviewStockDocument;
use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Inventory\Enums\StockDocumentType;
use App\Domain\Inventory\Enums\StockMovementType;
use App\Domain\Inventory\Queries\StockOverview;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Inventory\StoreStockDocumentRequest;
use App\Http\Resources\V1\Inventory\StockBatchResource;
use App\Http\Resources\V1\Inventory\StockDocumentResource;
use App\Http\Resources\V1\Inventory\StockLevelResource;
use App\Http\Resources\V1\Inventory\StockMovementResource;
use App\Models\Setting;
use App\Models\StockAdjustment;
use App\Models\StockBatch;
use App\Models\StockMovement;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Inventory: stock overview, stock documents (stock-in, stock-out, counts),
 * movement history and batches. Every stock change goes through the
 * StockLedger. Permissions are applied per route (inventory.view / adjust / approve).
 */
class InventoryController extends Controller
{
    public function stock(Request $request, StockOverview $overview): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'category_id' => ['nullable', 'uuid'],
            'status' => ['nullable', Rule::in(['out', 'low', 'ok'])],
            'include_inactive' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $filters['include_inactive'] = $request->boolean('include_inactive');

        return StockLevelResource::collection($overview->paginate($filters, (int) ($filters['per_page'] ?? 25)))
            ->additional(['summary' => $overview->summary($filters)]);
    }

    public function documents(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'type' => ['nullable', Rule::enum(StockDocumentType::class)],
            'status' => ['nullable', Rule::enum(DocumentStatus::class)],
            'q' => ['nullable', 'string', 'max:50'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $documents = StockAdjustment::query()
            ->with('creator', 'approver')
            ->withCount('items')
            ->when($filters['type'] ?? null, fn ($q, $type) => $q->where('type', $type))
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($filters['q'] ?? null, fn ($q, $term) => $q->where(fn ($q) => $q
                ->where('adjustment_number', 'like', "%{$term}%")->orWhere('reference', 'like', "%{$term}%")))
            ->latest()
            ->paginate($filters['per_page'] ?? 25);

        return StockDocumentResource::collection($documents);
    }

    public function showDocument(StockAdjustment $document): StockDocumentResource
    {
        return new StockDocumentResource($document->load('creator', 'approver', 'items.sku', 'items.unit', 'items.batch'));
    }

    public function stockIn(StoreStockDocumentRequest $request, CreateStockDocument $create): JsonResponse
    {
        return $this->create($request, $create, StockDocumentType::StockIn);
    }

    public function stockOut(StoreStockDocumentRequest $request, CreateStockDocument $create): JsonResponse
    {
        return $this->create($request, $create, StockDocumentType::StockOut);
    }

    public function adjustment(StoreStockDocumentRequest $request, CreateStockDocument $create): JsonResponse
    {
        return $this->create($request, $create, StockDocumentType::Adjustment);
    }

    public function approve(Request $request, StockAdjustment $document, ReviewStockDocument $review): StockDocumentResource
    {
        $review->approve($request->user(), $document);

        return $this->showDocument($document->refresh());
    }

    /** Approvers may reject any draft; authors may withdraw their own. */
    public function reject(Request $request, StockAdjustment $document, ReviewStockDocument $review): Response
    {
        $user = $request->user();
        if (! $user->hasPermission('inventory.approve') && $document->created_by !== $user->id) {
            throw new AuthorizationException('Only an approver or the author can discard this draft.');
        }

        $reason = $request->validate(['reason' => ['nullable', 'string', 'max:255']])['reason'] ?? null;
        $review->reject($user, $document, $reason);

        return response()->noContent();
    }

    public function movements(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'sku_id' => ['nullable', 'uuid'],
            'type' => ['nullable', Rule::enum(StockMovementType::class)],
            'document_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $tz = config('compriva.timezone');

        $movements = StockMovement::query()
            ->with(['sku', 'batch', 'creator', 'reference'])
            ->when($filters['sku_id'] ?? null, fn ($q, $id) => $q->where('product_sku_id', $id))
            ->when($filters['type'] ?? null, fn ($q, $type) => $q->where('type', $type))
            ->when($filters['document_id'] ?? null, fn ($q, $id) => $q->where('reference_id', $id))
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('occurred_at', '>=', Carbon::parse($from, $tz)->startOfDay()->utc()))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('occurred_at', '<=', Carbon::parse($to, $tz)->endOfDay()->utc()))
            ->orderByDesc('occurred_at')
            // Timestamps have 1-second precision; UUIDv7 ids are millisecond-ordered.
            ->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 50);

        return StockMovementResource::collection($movements);
    }

    public function batches(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'sku_id' => ['nullable', 'uuid'],
            'status' => ['nullable', Rule::in(['expired', 'expiring', 'ok'])],
            'include_empty' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $today = Carbon::now(config('compriva.timezone'))->toDateString();
        $window = (int) (Setting::whereNull('store_id')->where('group', 'inventory')->where('key', 'expiry_warning_days')->value('value') ?? 30);
        $windowEnd = Carbon::now(config('compriva.timezone'))->addDays($window)->toDateString();

        $batches = StockBatch::query()
            ->with('sku.baseUnit')
            ->when(! $request->boolean('include_empty'), fn ($q) => $q->where('remaining_quantity', '>', 0))
            ->when($filters['sku_id'] ?? null, fn ($q, $id) => $q->where('product_sku_id', $id))
            ->when(($filters['status'] ?? null) === 'expired', fn ($q) => $q->where('expiry_date', '<', $today))
            ->when(($filters['status'] ?? null) === 'expiring', fn ($q) => $q->whereBetween('expiry_date', [$today, $windowEnd]))
            ->when(($filters['status'] ?? null) === 'ok', fn ($q) => $q->where(fn ($q) => $q->whereNull('expiry_date')->orWhere('expiry_date', '>', $windowEnd)))
            // FEFO order: the batch that leaves first is listed first.
            ->orderByRaw('expiry_date IS NULL')
            ->orderBy('expiry_date')
            ->orderBy('received_at')
            ->paginate($filters['per_page'] ?? 50);

        return StockBatchResource::collection($batches)->additional(['meta' => ['expiry_warning_days' => $window]]);
    }

    private function create(StoreStockDocumentRequest $request, CreateStockDocument $create, StockDocumentType $type): JsonResponse
    {
        $document = $create->execute($request->user(), $type, $request->validated());

        return $this->showDocument($document)->response()->setStatusCode(201);
    }
}
