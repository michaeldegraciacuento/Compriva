<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Domain\Identity\Actions\AuthenticateUser;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Auth\LoginRequest;
use App\Http\Requests\V1\Auth\TokenLoginRequest;
use App\Http\Resources\V1\Identity\AuthSessionResource;
use App\Models\PersonalAccessToken;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;

/**
 * Sign-in: the web app gets a Sanctum session cookie (after GET
 * /sanctum/csrf-cookie); the desktop app gets a token for the same account.
 */
class SessionController extends Controller
{
    /** Desktop sessions last one working day; the user signs in again after that. */
    public const DESKTOP_TOKEN_TTL_HOURS = 12;

    public function store(LoginRequest $request, AuthenticateUser $authenticate): AuthSessionResource
    {
        if (! $request->hasSession()) {
            throw new BusinessException(
                'Session sign-in is only available to the Compriva web app. The desktop app signs in with /auth/token.',
                ErrorCode::BadRequest, 400,
            );
        }

        $user = $authenticate->execute($request->string('login')->toString(), $request->string('password')->toString());

        Auth::guard('web')->login($user);
        $request->session()->regenerate(); // prevents session fixation

        return new AuthSessionResource($user);
    }

    /**
     * Desktop app sign-in with username/email + password. The desktop app runs
     * on another origin (tauri.localhost), so it cannot use the web session
     * cookie and receives a Sanctum token instead.
     */
    public function token(TokenLoginRequest $request, AuthenticateUser $authenticate): AuthSessionResource
    {
        $user = $authenticate->execute($request->string('login')->toString(), $request->string('password')->toString());

        $expiresAt = now()->addHours(self::DESKTOP_TOKEN_TTL_HOURS);
        $name = 'desktop:'.($request->filled('device_name') ? $request->string('device_name') : 'app');
        $token = $user->createToken($name, ['*'], $expiresAt);

        return new AuthSessionResource($user, [
            'token' => $token->plainTextToken,
            'token_expires_at' => $expiresAt->toIso8601ZuluString(),
        ]);
    }

    public function show(Request $request): AuthSessionResource
    {
        return new AuthSessionResource($request->user());
    }

    public function destroy(Request $request, AuditLogger $audit): Response
    {
        $user = $request->user();
        $token = $user->currentAccessToken();

        $audit->record('auth.logout', $user);

        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        } else {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->noContent();
    }
}
