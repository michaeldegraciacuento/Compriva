<?php

namespace App\Domain\Identity\Actions;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Signs a user out everywhere: deletes their API tokens and web sessions,
 * optionally keeping the token or session making the current request.
 */
class RevokeUserAccess
{
    public function execute(User $user, ?int $exceptTokenId = null, ?string $exceptSessionId = null): int
    {
        $tokens = $user->tokens()
            ->when($exceptTokenId, fn ($q) => $q->whereKeyNot($exceptTokenId))
            ->delete();

        $sessions = DB::table('sessions')
            ->where('user_id', $user->getKey())
            ->when($exceptSessionId, fn ($q) => $q->where('id', '!=', $exceptSessionId))
            ->delete();

        return $tokens + $sessions;
    }
}
