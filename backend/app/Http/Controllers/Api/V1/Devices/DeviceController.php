<?php

namespace App\Http\Controllers\Api\V1\Devices;

use App\Domain\Devices\Actions\ManageDevices;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Devices\SaveDeviceRequest;
use App\Http\Resources\V1\Devices\DeviceResource;
use App\Models\Device;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** Terminal registration and revocation. Route group requires `devices.manage`. */
class DeviceController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        return DeviceResource::collection(Device::orderBy('code')->get());
    }

    /** Registers a terminal and returns its one-time pairing code (shown only now). */
    public function store(SaveDeviceRequest $request, ManageDevices $devices): JsonResponse
    {
        $store = Store::findOrFail($request->input('store_id', $request->defaultStoreId()));
        [$device, $code] = $devices->register($store, $request->string('code')->toString(), $request->string('name')->toString());

        return response()->json(['data' => [
            'device' => new DeviceResource($device->refresh()),
            'pairing_code' => $code,
        ]], 201);
    }

    public function show(Device $device): DeviceResource
    {
        return new DeviceResource($device);
    }

    public function update(SaveDeviceRequest $request, Device $device): DeviceResource
    {
        $device->update($request->validated());

        return new DeviceResource($device);
    }

    /** New pairing code, e.g. to move a terminal to a replacement PC. */
    public function pairingCode(Device $device, ManageDevices $devices): JsonResponse
    {
        $code = $devices->issuePairingCode($device);

        return response()->json(['data' => [
            'device' => new DeviceResource($device->refresh()),
            'pairing_code' => $code,
        ]]);
    }

    public function revoke(Request $request, Device $device, ManageDevices $devices): DeviceResource
    {
        return new DeviceResource($devices->revoke($request->user(), $device));
    }
}
