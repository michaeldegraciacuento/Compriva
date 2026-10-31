<?php

namespace App\Domain\Sync\Push;

use App\Domain\Sync\Enums\SyncOperationStatus;
use App\Models\Device;
use App\Models\SyncOperation;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Receives a batch of operations from a terminal's outbox (docs/README.md).
 *
 * - Idempotent: the operation ID is the primary key of sync_operations. An
 *   operation seen before returns `duplicate` with its original result, so
 *   retrying a batch after a timeout is always safe.
 * - Each operation is validated and applied in its own transaction together
 *   with its sync_operations row: it is applied completely or not at all, and
 *   one bad operation does not block the others.
 * - Operations that can never succeed are `rejected` with a code and message;
 *   the terminal keeps them for review (they are never discarded).
 * - A server error (5xx) stops the batch: later operations may depend on the
 *   failed one, so the terminal retries from there.
 */
class ApplyOperations
{
    public function __construct(
        private readonly OperationHandlers $handlers,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @param  list<array<string, mixed>>  $operations  validated, in local_seq order
     * @return list<array<string, mixed>>
     */
    public function execute(Device $device, array $operations): array
    {
        usort($operations, fn (array $a, array $b) => $a['local_seq'] <=> $b['local_seq']);
        $results = [];

        foreach ($operations as $operation) {
            $result = $this->one($device, $operation);
            $results[] = $result;
            if ($result['status'] === 'failed') {
                break;
            }
        }

        $device->forceFill(['last_synced_at' => now(), 'last_seen_at' => now()])->saveQuietly();

        return $results;
    }

    /** @return array<string, mixed> */
    private function one(Device $device, array $op): array
    {
        $existing = SyncOperation::find($op['operation_id']);
        if ($existing !== null) {
            return $this->duplicate($device, $existing, $op);
        }

        try {
            $result = DB::transaction(function () use ($device, $op) {
                $result = $this->handlers->apply($device, $op);
                $this->store($device, $op, SyncOperationStatus::Applied, $result);

                return $result;
            });

            return ['operation_id' => $op['operation_id'], 'status' => 'applied', 'result' => $result];
        } catch (OperationRejected|BusinessException|\InvalidArgumentException|\ValueError $e) {
            // Malformed numbers and the like can never succeed: reject rather than retry forever.
            $code = match (true) {
                $e instanceof OperationRejected => $e->errorCode,
                $e instanceof BusinessException => $e->errorCode->value,
                default => 'INVALID_PAYLOAD',
            };
            $this->store($device, $op, SyncOperationStatus::Rejected, null, $code, $e->getMessage());
            $this->audit->record('sync.operation_rejected', $device, new: ['operation_id' => $op['operation_id'], 'type' => $op['type'], 'code' => $code, 'message' => $e->getMessage()], device: $device);

            return ['operation_id' => $op['operation_id'], 'status' => 'rejected', 'error' => ['code' => $code, 'message' => $e->getMessage()]];
        } catch (UniqueConstraintViolationException $e) {
            // The same operation arrived twice at the same moment; the other request applied it.
            if ($again = SyncOperation::find($op['operation_id'])) {
                return $this->duplicate($device, $again, $op);
            }
            throw $e;
        } catch (Throwable $e) {
            Log::error('sync operation failed', ['operation_id' => $op['operation_id'], 'type' => $op['type'], 'exception' => $e]);

            return ['operation_id' => $op['operation_id'], 'status' => 'failed', 'error' => ['code' => 'SERVER_ERROR', 'message' => 'The server could not apply this operation; it will be retried.']];
        }
    }

    /** @return array<string, mixed> */
    private function duplicate(Device $device, SyncOperation $existing, array $op): array
    {
        if ($existing->device_id !== $device->id) {
            return ['operation_id' => $op['operation_id'], 'status' => 'rejected', 'error' => ['code' => 'CONFLICT', 'message' => 'This operation ID was already used by another terminal.']];
        }

        return $existing->status === SyncOperationStatus::Applied
            ? ['operation_id' => $op['operation_id'], 'status' => 'duplicate', 'result' => $existing->result]
            : ['operation_id' => $op['operation_id'], 'status' => 'rejected', 'error' => ['code' => $existing->error_code, 'message' => $existing->error_message]];
    }

    private function store(Device $device, array $op, SyncOperationStatus $status, ?array $result, ?string $code = null, ?string $message = null): void
    {
        SyncOperation::create([
            'id' => $op['operation_id'],
            'device_id' => $device->id,
            'local_seq' => $op['local_seq'],
            'type' => $op['type'],
            'schema_version' => $op['schema_version'] ?? 1,
            'payload' => $op['payload'],
            'status' => $status,
            'result' => $result,
            'error_code' => $code,
            'error_message' => $message === null ? null : mb_substr($message, 0, 255),
            'occurred_at' => Carbon::parse($op['created_at']),
            'received_at' => now(),
            'processed_at' => now(),
        ]);
    }
}
