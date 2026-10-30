<?php

namespace App\Http\Controllers\Api\V1\Sync;

use App\Domain\Inventory\Services\StockAllocations;
use App\Domain\Sync\Enums\SyncOperationStatus;
use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\ProductSku;
use App\Models\SyncConflict;
use App\Models\SyncCursor;
use App\Models\SyncOperation;
use App\Models\TerminalStockAllocation;
use App\Support\Audit\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * For managers: terminals with their sync health and stock allocations, and
 * the conflicts found while applying offline operations (inventory.allocate).
 */
class TerminalsController extends Controller
{
    public function index(): JsonResponse
    {
        $devices = Device::query()
            ->withCount([
                'syncOperations as applied_count' => fn ($q) => $q->where('status', SyncOperationStatus::Applied),
                'syncOperations as rejected_count' => fn ($q) => $q->where('status', SyncOperationStatus::Rejected),
            ])
            ->orderBy('code')
            ->get();
        $syncing = SyncCursor::pluck('device_id')->flip(); // desktop terminals have pulled at least once
        $conflicts = SyncConflict::whereNull('resolved_at')->selectRaw('device_id, COUNT(*) as total')->groupBy('device_id')->pluck('total', 'device_id');
        $allocations = TerminalStockAllocation::query()
            ->selectRaw('device_id, COUNT(*) as skus, SUM(allocated_quantity - consumed_quantity - released_quantity) as remaining')
            ->groupBy('device_id')->get()->keyBy('device_id');

        return response()->json(['data' => $devices->map(fn (Device $d) => [
            'id' => $d->id,
            'code' => $d->code,
            'name' => $d->name,
            'status' => $d->status,
            'syncs' => $syncing->has($d->id),
            'last_seen_at' => $d->last_seen_at?->toIso8601ZuluString(),
            'last_synced_at' => $d->last_synced_at?->toIso8601ZuluString(),
            'last_receipt_sequence' => $d->last_receipt_sequence,
            'operations_applied' => (int) $d->applied_count,
            'operations_rejected' => (int) $d->rejected_count,
            'open_conflicts' => (int) ($conflicts[$d->id] ?? 0),
            'allocated_skus' => (int) ($allocations[$d->id]->skus ?? 0),
            'allocated_units' => bcadd((string) ($allocations[$d->id]->remaining ?? '0'), '0', 4),
        ])]);
    }

    public function show(Device $device): JsonResponse
    {
        $allocations = TerminalStockAllocation::where('device_id', $device->id)->with('sku.baseUnit')->get()
            ->sortBy(fn ($a) => $a->sku->name)
            ->map(fn (TerminalStockAllocation $a) => [
                'sku' => ['id' => $a->sku->id, 'code' => $a->sku->code, 'name' => $a->sku->name, 'unit' => $a->sku->baseUnit->code],
                'allocated' => $a->allocated_quantity,
                'consumed' => $a->consumed_quantity,
                'released' => $a->released_quantity,
                'remaining' => $a->availableQuantity(),
                'last_event_at' => $a->last_event_at?->toIso8601ZuluString(),
            ])->values();
        $operations = SyncOperation::where('device_id', $device->id)->latest('received_at')->limit(50)->get()
            ->map(fn (SyncOperation $op) => [
                'id' => $op->id, 'local_seq' => $op->local_seq, 'type' => $op->type, 'status' => $op->status,
                'error_code' => $op->error_code, 'error_message' => $op->error_message,
                'occurred_at' => $op->occurred_at->toIso8601ZuluString(), 'received_at' => $op->received_at->toIso8601ZuluString(),
            ]);

        return response()->json(['data' => [
            'terminal' => ['id' => $device->id, 'code' => $device->code, 'name' => $device->name, 'status' => $device->status,
                'last_synced_at' => $device->last_synced_at?->toIso8601ZuluString()],
            'allocations' => $allocations,
            'operations' => $operations,
        ]]);
    }

    public function allocate(Request $request, Device $device, StockAllocations $allocations, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'sku_id' => ['required', 'uuid', 'exists:product_skus,id'],
            'quantity' => ['required', 'decimal:0,4', 'gt:0'],
        ]);
        $sku = ProductSku::findOrFail($data['sku_id']);
        $allocation = $allocations->allocateManually($device, $sku, (string) $data['quantity'], $request->user());
        $audit->record('allocation.manual', $device, new: ['sku_id' => $sku->id, 'quantity' => (string) $data['quantity']]);

        return response()->json(['data' => ['sku_id' => $sku->id, 'remaining' => $allocation->availableQuantity()]], 201);
    }

    public function conflicts(Request $request): JsonResponse
    {
        $input = $request->validate(['status' => ['nullable', 'in:open,resolved,all'], 'device_id' => ['nullable', 'uuid']]);
        $status = $input['status'] ?? 'open';

        $conflicts = SyncConflict::query()
            ->with('device', 'resolver')
            ->when($status === 'open', fn ($q) => $q->whereNull('resolved_at'))
            ->when($status === 'resolved', fn ($q) => $q->whereNotNull('resolved_at'))
            ->when($input['device_id'] ?? null, fn ($q, $id) => $q->where('device_id', $id))
            ->latest('detected_at')
            ->limit(200)
            ->get();

        return response()->json(['data' => $conflicts->map(fn (SyncConflict $c) => [
            'id' => $c->id,
            'terminal' => $c->device->code,
            'type' => $c->type,
            'message' => $c->message,
            'details' => $c->details,
            'detected_at' => $c->detected_at->toIso8601ZuluString(),
            'resolved_at' => $c->resolved_at?->toIso8601ZuluString(),
            'resolved_by' => $c->resolver?->name,
            'resolution_note' => $c->resolution_note,
        ])]);
    }

    public function resolve(Request $request, SyncConflict $conflict, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate(['note' => ['required', 'string', 'min:3', 'max:255']]);
        if ($conflict->resolved_at === null) {
            $conflict->forceFill(['resolved_at' => now(), 'resolved_by' => $request->user()->id, 'resolution_note' => $data['note']])->save();
            $audit->record('sync.conflict_resolved', $conflict, new: ['note' => $data['note']]);
        }

        return response()->json(['data' => ['id' => $conflict->id, 'resolved_at' => $conflict->resolved_at->toIso8601ZuluString()]]);
    }
}
