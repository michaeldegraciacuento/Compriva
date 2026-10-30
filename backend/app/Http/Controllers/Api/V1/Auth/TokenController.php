<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Identity\TokenResource;
use App\Support\Audit\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/** The signed-in user's own API tokens (terminal sessions). */
class TokenController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return TokenResource::collection($request->user()->tokens()->latest('id')->get());
    }

    public function destroy(Request $request, int $token, AuditLogger $audit): Response
    {
        $model = $request->user()->tokens()->findOrFail($token);
        $model->delete();
        $audit->record('auth.token_revoked', $request->user(), new: ['token_id' => $token, 'name' => $model->name]);

        return response()->noContent();
    }
}
