<?php

namespace App\Domain\Cashiering\Actions;

use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Cashiering\Queries\ShiftSummary;
use App\Models\CashierShift;
use App\Models\Device;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * Opening and closing cashier shifts. One open shift per terminal (enforced by
 * a unique index too) and per cashier. Closing counts the drawer and stores the
 * variance against the expected cash; a closed shift is frozen by triggers.
 */
class ManageShifts
{
    private const SCALE = 4;

    public function __construct(
        private readonly ShiftSummary $summary,
        private readonly AuditLogger $audit,
    ) {}

    public function open(Device $device, User $cashier, string $openingFloat, ?string $notes = null): CashierShift
    {
        return DB::transaction(function () use ($device, $cashier, $openingFloat, $notes) {
            Device::whereKey($device->id)->lockForUpdate()->first();

            $onTerminal = CashierShift::where('device_id', $device->id)->where('status', ShiftStatus::Open)->with('cashier')->first();
            if ($onTerminal !== null) {
                throw new BusinessException(
                    "Terminal {$device->code} already has an open shift ({$onTerminal->cashier->name}). Close it first.",
                    ErrorCode::Conflict, 409, ['reason' => 'terminal_shift_open', 'shift_id' => $onTerminal->id],
                );
            }

            $elsewhere = CashierShift::where('cashier_id', $cashier->id)->where('status', ShiftStatus::Open)->with('device')->first();
            if ($elsewhere !== null) {
                throw new BusinessException(
                    "You already have an open shift on terminal {$elsewhere->device->code}. Close it there first.",
                    ErrorCode::Conflict, 409, ['reason' => 'cashier_shift_open', 'shift_id' => $elsewhere->id],
                );
            }

            $shift = CashierShift::create([
                'store_id' => $device->store_id,
                'device_id' => $device->id,
                'cashier_id' => $cashier->id,
                'status' => ShiftStatus::Open,
                'opening_float' => $openingFloat,
                'opened_at' => now(),
                'notes' => $notes,
            ]);
            $device->forceFill(['last_seen_at' => now()])->save();
            $this->audit->record('shift.opened', $shift, new: ['terminal' => $device->code, 'opening_float' => $openingFloat]);

            return $shift;
        });
    }

    /** @return array{shift: CashierShift, summary: array<string, mixed>} */
    public function close(CashierShift $shift, User $actor, string $countedCash, ?string $notes = null): array
    {
        if ($shift->cashier_id !== $actor->id && ! $actor->hasPermission('cashier.manage_shifts')) {
            throw new AuthorizationException('Only the cashier or a manager can close this shift.');
        }

        return DB::transaction(function () use ($shift, $actor, $countedCash, $notes) {
            $shift = CashierShift::whereKey($shift->id)->lockForUpdate()->firstOrFail();
            if ($shift->status === ShiftStatus::Closed) {
                throw new BusinessException('This shift is already closed.', ErrorCode::Conflict, 409);
            }

            $summary = $this->summary->for($shift);
            $variance = bcsub($countedCash, $summary['expected_cash'], self::SCALE);

            $shift->forceFill([
                'status' => ShiftStatus::Closed,
                'expected_cash' => $summary['expected_cash'],
                'counted_cash' => $countedCash,
                'cash_variance' => $variance,
                'closed_at' => now(),
                'closed_by' => $actor->id,
                'notes' => trim(implode("\n", array_filter([$shift->notes, $notes]))) ?: null,
            ])->save();

            $this->audit->record('shift.closed', $shift, new: [
                'expected_cash' => $summary['expected_cash'], 'counted_cash' => $countedCash, 'variance' => $variance,
            ]);

            return ['shift' => $shift->refresh(), 'summary' => $summary];
        });
    }
}
