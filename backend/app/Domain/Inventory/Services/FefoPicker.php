<?php

namespace App\Domain\Inventory\Services;

use App\Models\ProductSku;
use App\Models\StockBatch;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;

/**
 * First-Expired, First-Out: decides which batches stock leaves from.
 *
 * Order: earliest expiry first (batches without an expiry date last), then the
 * oldest received. Batches are locked for update; call inside a transaction.
 */
class FefoPicker
{
    private const SCALE = 4;

    /** @return list<array{batch: StockBatch, quantity: string}> */
    public function pick(string $storeId, ProductSku $sku, string $quantity): array
    {
        $batches = StockBatch::where('store_id', $storeId)
            ->where('product_sku_id', $sku->id)
            ->where('remaining_quantity', '>', 0)
            ->orderByRaw('expiry_date IS NULL')
            ->orderBy('expiry_date')
            ->orderBy('received_at')
            ->lockForUpdate()
            ->get();

        $picks = [];
        $left = $quantity;
        foreach ($batches as $batch) {
            if (bccomp($left, '0', self::SCALE) <= 0) {
                break;
            }
            $take = bccomp($batch->remaining_quantity, $left, self::SCALE) < 0 ? $batch->remaining_quantity : $left;
            $picks[] = ['batch' => $batch, 'quantity' => $take];
            $left = bcsub($left, $take, self::SCALE);
        }

        if (bccomp($left, '0', self::SCALE) > 0) {
            throw new BusinessException(
                "Not enough stock in batches of {$sku->name}.",
                ErrorCode::InsufficientStock, 422,
                ['sku_id' => $sku->id, 'requested' => $quantity, 'missing' => $left],
            );
        }

        return $picks;
    }

    /** A specific batch chosen by the user. @return list<array{batch: StockBatch, quantity: string}> */
    public function fromBatch(string $batchId, ProductSku $sku, string $quantity): array
    {
        $batch = StockBatch::whereKey($batchId)->where('product_sku_id', $sku->id)->lockForUpdate()->firstOrFail();

        if (bccomp($batch->remaining_quantity, $quantity, self::SCALE) < 0) {
            throw new BusinessException(
                "Batch {$batch->batch_number} has only {$batch->remaining_quantity} left.",
                ErrorCode::InsufficientStock, 422,
                ['batch_id' => $batch->id, 'available' => $batch->remaining_quantity, 'requested' => $quantity],
            );
        }

        return [['batch' => $batch, 'quantity' => $quantity]];
    }
}
