<?php

namespace App\Domain\Devices\Actions;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * A terminal exchanges a one-time pairing code for its device token.
 *
 * Binds the device row to the terminal's install ID, activates it, replaces
 * any previous tokens, and consumes the code.
 */
class PairDevice
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * @param  array{install_id: string, machine_name?: ?string, os?: ?string, app_version?: ?string}  $terminal
     * @return array{0: Device, 1: string} the device and its plain device token (shown once)
     */
    public function execute(string $pairingCode, array $terminal): array
    {
        return DB::transaction(function () use ($pairingCode, $terminal) {
            $device = Device::query()
                ->where('pairing_code_hash', ManageDevices::hashCode($pairingCode))
                ->where('pairing_code_expires_at', '>', now())
                ->where('status', '!=', DeviceStatus::Revoked)
                ->lockForUpdate()
                ->first();

            if (! $device) {
                $this->audit->record('device.pairing_failed', new: ['install_id' => $terminal['install_id']]);

                throw new BusinessException('The pairing code is invalid or has expired. Ask a manager for a new code.', ErrorCode::PairingCodeInvalid, 422);
            }

            $this->releaseInstallId($device, $terminal['install_id']);

            ManageDevices::deleteTokens($device);
            $device->forceFill([
                'install_id' => $terminal['install_id'],
                'machine_name' => $terminal['machine_name'] ?? null,
                'os' => $terminal['os'] ?? null,
                'app_version' => $terminal['app_version'] ?? null,
                'status' => DeviceStatus::Active,
                'paired_at' => now(),
                'last_seen_at' => now(),
                'pairing_code_hash' => null,
                'pairing_code_expires_at' => null,
            ])->save();

            $token = $device->createToken("device:{$device->code}", [PersonalAccessToken::ABILITY_DEVICE]);

            $this->audit->record('device.paired', $device, new: [
                'install_id' => $device->install_id, 'machine_name' => $device->machine_name, 'app_version' => $device->app_version,
            ], device: $device);

            return [$device, $token->plainTextToken];
        });
    }

    /** One installation = one active terminal. A revoked terminal gives up its install ID. */
    private function releaseInstallId(Device $device, string $installId): void
    {
        $other = Device::where('install_id', $installId)->whereKeyNot($device->id)->first();

        if ($other === null) {
            return;
        }

        if ($other->status !== DeviceStatus::Revoked) {
            throw new BusinessException(
                "This computer is already registered as terminal {$other->code}. Revoke it first.",
                ErrorCode::Conflict, 409, ['reason' => 'install_registered', 'device_code' => $other->code],
            );
        }

        $other->forceFill(['install_id' => null])->save();
    }
}
