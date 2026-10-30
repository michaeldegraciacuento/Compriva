<?php

namespace App\Domain\Sales\Services;

use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\Hash;

/**
 * Manager override at the till. Actions such as voids, returns, discounts and
 * price overrides need a permission the cashier may not hold. The cashier's
 * own permission is enough; otherwise a user who holds it enters their
 * username and PIN (or password) on the cashier's screen.
 *
 * Without credentials the API answers APPROVAL_REQUIRED (403) with the
 * permission in details, and the POS asks for a manager.
 */
class SupervisorApproval
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Returns who authorized the action: the actor, or the approving manager.
     *
     * @param  ?array{login?: string, secret?: string}  $approval
     */
    public function authorize(User $actor, string $permission, ?array $approval, string $action): User
    {
        if ($actor->hasPermission($permission)) {
            return $actor;
        }

        if (empty($approval['login']) || empty($approval['secret'])) {
            throw new BusinessException("{$action} needs a manager's approval.", ErrorCode::ApprovalRequired, 403, ['permission' => $permission]);
        }

        $approver = User::where('username', $approval['login'])->orWhere('email', $approval['login'])->first();
        $secret = $approval['secret'];
        $valid = $approver !== null && $approver->is_active
            && (($approver->pin_hash !== null && Hash::check($secret, $approver->pin_hash)) || Hash::check($secret, $approver->password));

        if (! $valid || ! $approver->hasPermission($permission)) {
            $this->audit->record('approval.denied', $approver, new: ['permission' => $permission, 'action' => $action, 'login' => $approval['login']]);

            throw new BusinessException('Approval refused: wrong credentials, or this user may not approve it.', ErrorCode::ApprovalRequired, 403, ['permission' => $permission, 'reason' => 'invalid_approver']);
        }

        $this->audit->record('approval.granted', $approver, new: ['permission' => $permission, 'action' => $action, 'for_user_id' => $actor->id]);

        return $approver;
    }
}
