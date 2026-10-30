<?php

namespace App\Domain\Sync;

use App\Domain\Sync\Enums\SyncChangeOperation;
use App\Models\SyncChange;

/**
 * Appends to the change log that terminals pull (docs/offline-sync.md §5).
 *
 * The cursor is sync_changes.id, an auto-increment sequence: strictly
 * increasing and gap-tolerant, unlike timestamps (two changes in the same
 * millisecond, clock changes). Rows only say WHAT changed; the pull reads the
 * current state, so a change recorded twice is harmless.
 *
 * Streams and entities:
 *   catalog      product_sku (sellable item), category
 *   cashiers     user (the whole cashier snapshot is resent)
 *   settings     payment_method, discount, setting, store
 *   allocations  terminal_stock_allocation (only for its terminal)
 */
final class SyncChanges
{
    public static function record(string $stream, string $entity, string $id, ?string $deviceId = null, SyncChangeOperation $operation = SyncChangeOperation::Upsert): void
    {
        SyncChange::create([
            'stream' => $stream,
            'entity' => $entity,
            'entity_id' => $id,
            'device_id' => $deviceId,
            'operation' => $operation,
            'changed_at' => now(),
        ]);
    }

    /** @param iterable<string> $skuIds */
    public static function skus(iterable $skuIds): void
    {
        foreach (collect($skuIds)->unique() as $id) {
            self::record('catalog', 'product_sku', $id);
        }
    }

    public static function cashiers(string $userId): void
    {
        self::record('cashiers', 'user', $userId);
    }
}
