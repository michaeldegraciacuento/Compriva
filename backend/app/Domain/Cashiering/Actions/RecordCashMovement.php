<?php

namespace App\Domain\Cashiering\Actions;

use App\Domain\Cashiering\Enums\CashMovementType;
use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Cashiering\Queries\ShiftSummary;
use App\Domain\Sales\Pricing\FixedPoint;
use App\Domain\Sales\Services\SupervisorApproval;
use App\Models\CashierShift;
use App\Models\CashMovement;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * Cash put into or taken out of the drawer outside a sale:
 * - cash in: extra change fund, e.g. coins from the office
 * - cash out: paying a small expense from the drawer
 * - cash drop: moving excess cash to the safe
 *
 * Needs cashier.cash_movements or a manager's approval. Money can only leave
 * the drawer if it is there (expected cash). Movements are append-only and
 * feed the expected cash at closing.
 */
class RecordCashMovement
{
    public function __construct(
        private readonly SupervisorApproval $approval,
        private readonly ShiftSummary $summary,
        private readonly AuditLogger $audit,
    ) {}

    public function execute(CashierShift $shift, User $actor, CashMovementType $type, string $amount, string $reason, ?array $approval = null): CashMovement
    {
        if ($shift->cashier_id !== $actor->id && ! $actor->hasPermission('cashier.manage_shifts')) {
            throw new AuthorizationException('Only the cashier of this shift or a manager can record cash movements.');
        }
        $approver = $this->approval->authorize($actor, 'cashier.cash_movements', $approval, 'Cash in or out');

        return DB::transaction(function () use ($shift, $actor, $approver, $type, $amount, $reason) {
            $shift = CashierShift::whereKey($shift->id)->lockForUpdate()->firstOrFail();
            if ($shift->status !== ShiftStatus::Open) {
                throw new BusinessException('This shift is closed.', ErrorCode::Conflict, 409);
            }

            if ($type !== CashMovementType::CashIn) {
                $inDrawer = $this->summary->for($shift)['expected_cash'];
                if (bccomp($amount, $inDrawer, 4) > 0) {
                    $message = 'Only ₱'.FixedPoint::format(FixedPoint::roundCents($inDrawer)).' should be in the drawer.';
                    throw new BusinessException($message, ErrorCode::ValidationFailed, 422, ['fields' => ['amount' => [$message]]]);
                }
            }

            $movement = CashMovement::create([
                'cashier_shift_id' => $shift->id,
                'type' => $type,
                'amount' => $amount,
                'reason' => $reason,
                'performed_by' => $actor->id,
                'approved_by' => $approver->id !== $actor->id ? $approver->id : null,
                'occurred_at' => now(),
                'created_at' => now(),
            ]);
            $this->audit->record("cash.{$type->value}", $shift, new: ['amount' => $amount, 'reason' => $reason, 'approved_by' => $approver->id]);

            return $movement;
        });
    }
}
