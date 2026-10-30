<?php

namespace App\Http\Middleware;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route middleware `actor.device`: the request must carry a terminal's device
 * token, the terminal must be active, and X-Compriva-Device must match the
 * install ID the token was paired with.
 */
class EnsureActiveDevice
{
    public function handle(Request $request, Closure $next): Response
    {
        $device = $request->user();

        if (! $device instanceof Device || ! $device->tokenCan(PersonalAccessToken::ABILITY_DEVICE)) {
            throw new BusinessException('A registered terminal is required.', ErrorCode::DeviceNotRegistered, 401);
        }

        if ($device->status !== DeviceStatus::Active) {
            throw new BusinessException('This terminal has been revoked.', ErrorCode::DeviceRevoked, 403);
        }

        if ($request->header('X-Compriva-Device') !== $device->install_id) {
            throw new BusinessException('This token belongs to another terminal.', ErrorCode::DeviceNotRegistered, 401);
        }

        // Heartbeat, written at most once a minute.
        if ($device->last_seen_at === null || $device->last_seen_at->lt(now()->subMinute())) {
            $device->forceFill(['last_seen_at' => now()])->saveQuietly();
        }

        return $next($request);
    }
}
