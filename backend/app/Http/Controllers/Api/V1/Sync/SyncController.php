<?php

namespace App\Http\Controllers\Api\V1\Sync;

use App\Domain\Inventory\Services\StockAllocations;
use App\Domain\Sync\Push\ApplyOperations;
use App\Domain\Sync\Push\OperationHandlers;
use App\Domain\Sync\Queries\TerminalData;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Sales\PosResources;
use App\Models\Device;
use App\Models\SyncChange;
use App\Models\SyncConflict;
use App\Models\SyncCursor;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Terminal ↔ server synchronization (docs/README.md). Every route
 * needs the terminal's device token and its X-Compriva-Device header.
 */
class SyncController extends Controller
{
    private const STREAM = 'all';

    /** Push: apply a batch of outbox operations, in order, idempotently. */
    public function push(Request $request, ApplyOperations $apply): JsonResponse
    {
        $data = $request->validate([
            'operations' => ['required', 'array', 'min:1', 'max:100'],
            'operations.*.operation_id' => ['required', 'uuid', 'distinct'],
            'operations.*.local_seq' => ['required', 'integer', 'min:1', 'distinct'],
            'operations.*.type' => ['required', Rule::in(OperationHandlers::TYPES)],
            'operations.*.schema_version' => ['nullable', 'integer', 'min:1', 'max:1'],
            'operations.*.created_at' => ['required', 'date'],
            'operations.*.payload' => ['required', 'array'],
        ]);

        return response()->json(['data' => ['results' => $apply->execute($this->device($request), $data['operations'])]]);
    }

    /**
     * Pull: without a cursor, a full snapshot and the cursor to continue from;
     * with one, the changes after it (at most `limit` change rows). The cursor
     * is the change log's sequence number, never a timestamp.
     */
    public function changes(Request $request, TerminalData $data): JsonResponse
    {
        $input = $request->validate([
            'cursor' => ['nullable', 'integer', 'min:0'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ]);
        $device = $this->device($request);
        // Read the position BEFORE the data: anything changed meanwhile is replayed next time (upserts are idempotent).
        $head = (int) (SyncChange::max('id') ?? 0);

        if (! isset($input['cursor'])) {
            $items = $data->items();
            $this->remember($device, $head);

            return response()->json(['data' => [
                'mode' => 'snapshot',
                'cursor' => $head,
                'has_more' => false,
                'server_time' => now()->toIso8601ZuluString(),
                'snapshot' => [
                    // The last receipt number the server has seen: a reinstalled terminal continues after it.
                    'terminal' => PosResources::terminal($device) + ['last_receipt_sequence' => $device->last_receipt_sequence],
                    'items' => $items['items'],
                    'categories' => $data->categories(),
                    'payment_methods' => $data->paymentMethods(),
                    'discounts' => $data->discounts(),
                    'cashiers' => $data->cashiers(),
                    'customers' => $data->customers()['customers'],
                    'settings' => $data->settings(),
                    'allocations' => $data->allocations($device),
                ],
            ]]);
        }

        $cursor = (int) $input['cursor'];
        if ($cursor > $head) {
            // The server's log is behind the terminal (e.g. a restored database): start over from a snapshot.
            throw new BusinessException('The sync position is unknown to the server. Download a full snapshot.', ErrorCode::SyncCursorInvalid, 410);
        }

        $limit = (int) ($input['limit'] ?? 500);
        $rows = SyncChange::where('id', '>', $cursor)
            ->where(fn ($q) => $q->whereNull('device_id')->orWhere('device_id', $device->id))
            ->orderBy('id')->limit($limit)->get();
        $next = (int) ($rows->last()?->id ?? $cursor);

        $changes = [];
        $skuIds = $rows->where('entity', 'product_sku')->pluck('entity_id')->unique()->values()->all();
        if ($skuIds !== []) {
            $items = $data->items($skuIds);
            foreach ($items['items'] as $item) {
                $changes[] = ['entity' => 'item', 'op' => 'upsert', 'id' => $item['id'], 'data' => $item];
            }
            foreach ($items['removed'] as $id) {
                $changes[] = ['entity' => 'item', 'op' => 'delete', 'id' => $id];
            }
        }
        if ($rows->contains('entity', 'category')) {
            $changes[] = ['entity' => 'categories', 'op' => 'replace', 'data' => $data->categories()];
        }
        $customerIds = $rows->where('entity', 'customer')->pluck('entity_id')->unique()->values()->all();
        if ($customerIds !== []) {
            $customers = $data->customers($customerIds);
            foreach ($customers['customers'] as $customer) {
                $changes[] = ['entity' => 'customer', 'op' => 'upsert', 'id' => $customer['id'], 'data' => $customer];
            }
            foreach ($customers['removed'] as $id) {
                $changes[] = ['entity' => 'customer', 'op' => 'delete', 'id' => $id];
            }
        }
        if ($rows->contains('stream', 'cashiers')) {
            $changes[] = ['entity' => 'cashiers', 'op' => 'replace', 'data' => $data->cashiers()];
        }
        if ($rows->contains('entity', 'payment_method')) {
            $changes[] = ['entity' => 'payment_methods', 'op' => 'replace', 'data' => $data->paymentMethods()];
        }
        if ($rows->contains('entity', 'discount')) {
            $changes[] = ['entity' => 'discounts', 'op' => 'replace', 'data' => $data->discounts()];
        }
        if ($rows->contains(fn ($row) => in_array($row->entity, ['setting', 'store'], true))) {
            $changes[] = ['entity' => 'settings', 'op' => 'replace', 'data' => $data->settings()];
        }
        $allocationIds = $rows->where('entity', 'terminal_stock_allocation')->pluck('entity_id')->unique()->values()->all();
        if ($allocationIds !== []) {
            foreach ($data->allocations($device, $allocationIds) as $allocation) {
                $changes[] = ['entity' => 'allocation', 'op' => 'upsert', 'id' => $allocation['sku_id'], 'data' => $allocation];
            }
        }

        $this->remember($device, $next);

        return response()->json(['data' => [
            'mode' => 'changes',
            'cursor' => $next,
            'has_more' => $rows->count() === $limit,
            'server_time' => now()->toIso8601ZuluString(),
            'changes' => $changes,
            'open_conflicts' => SyncConflict::where('device_id', $device->id)->whereNull('resolved_at')->count(),
        ]]);
    }

    /**
     * Asks for this terminal's fair share of stock. Returns the allocations that
     * grew (they also arrive with the next pull) and `excess`: stock it holds
     * above its share, which the terminal should release through its outbox.
     */
    public function topUp(Request $request, StockAllocations $allocations, TerminalData $data): JsonResponse
    {
        $input = $request->validate(['sku_ids' => ['nullable', 'array', 'max:2000'], 'sku_ids.*' => ['uuid']]);
        $device = $this->device($request);
        ['changed' => $changed, 'excess' => $excess] = $allocations->topUp($device, $input['sku_ids'] ?? null);

        return response()->json(['data' => [
            'allocations' => $changed === [] ? [] : $data->allocations($device, $changed),
            'excess' => collect($excess)->map(fn (string $quantity, string $skuId) => ['sku_id' => $skuId, 'quantity' => $quantity])->values(),
        ]]);
    }

    private function device(Request $request): Device
    {
        return $request->user();
    }

    private function remember(Device $device, int $position): void
    {
        SyncCursor::updateOrCreate(['device_id' => $device->id, 'stream' => self::STREAM], ['position' => $position, 'last_pulled_at' => now()]);
        $device->forceFill(['last_synced_at' => now()])->saveQuietly();
    }
}
