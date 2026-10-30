<?php

namespace App\Http\Resources\V1\Devices;

use App\Models\Device;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Device */
class DeviceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'code' => $this->code,
            'name' => $this->name,
            'status' => $this->status,
            'install_id' => $this->install_id,
            'machine_name' => $this->machine_name,
            'os' => $this->os,
            'app_version' => $this->app_version,
            'pairing_code_expires_at' => $this->pairing_code_expires_at?->toIso8601ZuluString(),
            'paired_at' => $this->paired_at?->toIso8601ZuluString(),
            'last_seen_at' => $this->last_seen_at?->toIso8601ZuluString(),
            'last_synced_at' => $this->last_synced_at?->toIso8601ZuluString(),
            'revoked_at' => $this->revoked_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
