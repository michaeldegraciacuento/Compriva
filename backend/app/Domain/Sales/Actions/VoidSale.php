<?php

namespace App\Domain\Sales\Actions;

use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Inventory\Services\StockLedger;
use App\Domain\Sales\Enums\SaleStatus;
use App\Domain\Sales\Services\SupervisorApproval;
use App\Models\Sale;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Cancels a whole sale, e.g. a mistake noticed while the customer is still at
 * the counter. Needs sales.void (or a manager's approval).
 *
 * Allowed only while the sale's shift is still open and before anything was
 * returned; later corrections are returns. The sale itself is preserved: only
 * its status changes (completed → voided), and the stock goes back through
 * the StockLedger as sale_void movements.
 */
class VoidSale
{
    public function __construct(
        private readonly SupervisorApproval $approval,
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function execute(Sale $sale, User $actor, string $reason, ?array $approval = null): Sale
    {
        $approver = $this->approval->authorize($actor, 'sales.void', $approval, "Voiding {$sale->receipt_number}");

        return DB::transaction(function () use ($sale, $actor, $approver, $reason) {
            $sale = Sale::whereKey($sale->id)->lockForUpdate()->with('shift')->firstOrFail();

            if ($sale->status === SaleStatus::Voided) {
                throw new BusinessException("{$sale->receipt_number} is already voided.", ErrorCode::Conflict, 409);
            }
            if ($sale->shift->status !== ShiftStatus::Open) {
                throw new BusinessException("{$sale->receipt_number} belongs to a closed shift. Process a return instead.", ErrorCode::Conflict, 409, ['reason' => 'shift_closed']);
            }
            if ($sale->returns()->exists()) {
                throw new BusinessException("{$sale->receipt_number} already has returns, so it cannot be voided.", ErrorCode::Conflict, 409, ['reason' => 'has_returns']);
            }

            $this->ledger->reverseSale($sale, $actor);

            $sale->forceFill([
                'status' => SaleStatus::Voided,
                'voided_at' => now(),
                'voided_by' => $approver->id,
                'void_reason' => $reason,
            ])->save();

            $this->audit->record('sale.voided', $sale, new: [
                'receipt_number' => $sale->receipt_number, 'reason' => $reason, 'requested_by' => $actor->id, 'approved_by' => $approver->id,
            ]);

            return $sale;
        });
    }
}
