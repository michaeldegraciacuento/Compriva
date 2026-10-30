<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Domain\Identity\Actions\ChangePassword;
use App\Domain\Identity\Actions\SetUserPin;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Auth\ChangePasswordRequest;
use App\Http\Requests\V1\Auth\ChangePinRequest;
use App\Http\Requests\V1\Auth\UpdateProfileRequest;
use App\Http\Resources\V1\Identity\AuthSessionResource;
use App\Models\PersonalAccessToken;
use App\Support\Audit\AuditLogger;
use Illuminate\Http\Response;

/** The signed-in user's own profile, password and PIN. */
class ProfileController extends Controller
{
    public function update(UpdateProfileRequest $request, AuditLogger $audit): AuthSessionResource
    {
        $user = $request->user();
        $before = $user->only(array_keys($request->validated()));

        $user->update($request->validated());
        $audit->record('auth.profile_updated', $user, $before, $request->validated());

        return new AuthSessionResource($user);
    }

    /** Keeps the current session or token; signs out everywhere else. */
    public function password(ChangePasswordRequest $request, ChangePassword $change): Response
    {
        $user = $request->user();
        $token = $user->currentAccessToken();

        $change->execute(
            $user,
            $request->string('password')->toString(),
            keepTokenId: $token instanceof PersonalAccessToken ? $token->id : null,
            keepSessionId: $request->hasSession() ? $request->session()->getId() : null,
        );

        return response()->noContent();
    }

    public function pin(ChangePinRequest $request, SetUserPin $setPin): Response
    {
        $setPin->execute($request->user(), $request->string('pin')->toString());

        return response()->noContent();
    }
}
