<?php

namespace App\Http\Controllers\Api\V1\Terminal;

use App\Domain\Devices\Actions\PairDevice;
use App\Domain\Identity\Actions\AuthenticateCashier;
use App\Domain\Identity\Queries\TerminalCashiers;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Terminal\CashierLoginRequest;
use App\Http\Requests\V1\Terminal\PairDeviceRequest;
use App\Http\Resources\V1\Devices\DeviceResource;
use App\Http\Resources\V1\Identity\AuthSessionResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Endpoints used by checkout terminals (docs/README.md). */
class TerminalController extends Controller
{
    /** Public (rate-limited): exchange a pairing code for the device token. */
    public function pair(PairDeviceRequest $request, PairDevice $pair): JsonResponse
    {
        [$device, $token] = $pair->execute($request->string('pairing_code')->toString(), $request->safe()->except('pairing_code'));

        return response()->json(['data' => [
            'device' => new DeviceResource($device),
            'device_token' => $token,
        ]], 201);
    }

    /** Device token: the terminal's own registration. */
    public function device(Request $request): DeviceResource
    {
        return new DeviceResource($request->user());
    }

    /** Device token: online cashier sign-in with username + PIN. */
    public function login(CashierLoginRequest $request, AuthenticateCashier $authenticate): AuthSessionResource
    {
        $session = $authenticate->execute(
            $request->user(),
            $request->string('username')->toString(),
            $request->string('pin')->toString(),
        );

        return new AuthSessionResource($session['user'], [
            'token' => $session['token'],
            'token_expires_at' => $session['expires_at']->toIso8601ZuluString(),
        ]);
    }

    /** Device token: cashier snapshot for offline sign-in. */
    public function cashiers(TerminalCashiers $cashiers): JsonResponse
    {
        return response()->json(['data' => $cashiers->get()]);
    }
}
