<?php

namespace App\Domain\Inventory\Actions;

use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Inventory\Services\StockLedger;
use App\Models\StockAdjustment;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/** Manager review of draft stock documents (`inventory.approve`). */
class ReviewStockDocument
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function approve(User $actor, StockAdjustment $document): StockAdjustment
    {
        return $this->ledger->post($document, $actor);
    }

    /** A rejected draft is deleted; it never changed stock. The audit log keeps the record. */
    public function reject(User $actor, StockAdjustment $document, ?string $reason): void
    {
        if ($document->status === DocumentStatus::Posted) {
            throw new BusinessException('Posted documents cannot be rejected; post a correcting document instead.', ErrorCode::Conflict, 409);
        }

        DB::transaction(function () use ($document, $reason) {
            $this->audit->record('stock_document.rejected', $document, new: [
                'number' => $document->adjustment_number, 'type' => $document->type->value, 'reason' => $reason,
            ]);
            $document->items()->delete();
            $document->delete();
        });
    }
}
