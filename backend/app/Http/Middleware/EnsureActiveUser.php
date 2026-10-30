<?php

namespace App\Http\Middleware;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route middleware `actor.user`: the request must be made by an active person
 * (web session or cashier token), never by a terminal's device token.
 *
 * Re-checked on every request, so suspending a user or revoking a device takes
 * effect immediately even for sessions and tokens that are still valid.
 */
class EnsureActiveUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        if (! $user->is_active) {
            throw new BusinessException('This account is suspended. Contact your manager.', ErrorCode::AccountSuspended, 403);
        }

        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken && $token->device_id !== null) {
            $device = $token->device;

            if ($device === null || $device->status !== DeviceStatus::Active) {
                throw new BusinessException('This terminal has been revoked.', ErrorCode::DeviceRevoked, 403);
            }
            if ($request->header('X-Compriva-Device') !== $device->install_id) {
                throw new BusinessException('This token belongs to another terminal.', ErrorCode::DeviceNotRegistered, 401);
            }
        }

        return $next($request);
    }
}
