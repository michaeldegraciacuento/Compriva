<?php

namespace App\Domain\Devices\Actions;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\Store;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Terminal lifecycle on the admin side: register → issue pairing code →
 * (terminal pairs, see PairDevice) → revoke.
 *
 * Pairing codes are 8 characters from an unambiguous alphabet (≈40 bits),
 * valid for 30 minutes, single use, and stored only as a SHA-256 hash.
 */
class ManageDevices
{
    public const PAIRING_CODE_TTL_MINUTES = 30;

    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public function __construct(private readonly AuditLogger $audit) {}

    /** @return array{0: Device, 1: string} the device and its plain pairing code */
    public function register(Store $store, string $code, string $name): array
    {
        return DB::transaction(function () use ($store, $code, $name) {
            $device = Device::create(['store_id' => $store->id, 'code' => strtoupper($code), 'name' => $name, 'status' => DeviceStatus::Pending]);
            $this->audit->record('device.registered', $device, new: ['code' => $device->code, 'name' => $name]);

            return [$device, $this->issuePairingCode($device)];
        });
    }

    /** Returns the plain code. Shown once; only its hash is stored. */
    public function issuePairingCode(Device $device): string
    {
        if ($device->status === DeviceStatus::Revoked) {
            throw new BusinessException('A revoked terminal cannot be paired again. Register a new terminal.', ErrorCode::Conflict, 409, ['reason' => 'device_revoked']);
        }

        $plain = '';
        for ($i = 0; $i < 8; $i++) {
            $plain .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        $device->forceFill([
            'pairing_code_hash' => self::hashCode($plain),
            'pairing_code_expires_at' => now()->addMinutes(self::PAIRING_CODE_TTL_MINUTES),
        ])->save();

        $this->audit->record('device.pairing_code_issued', $device);

        return substr($plain, 0, 4).'-'.substr($plain, 4);
    }

    public function revoke(User $actor, Device $device): Device
    {
        return DB::transaction(function () use ($actor, $device) {
            $device->forceFill([
                'status' => DeviceStatus::Revoked,
                'revoked_at' => now(),
                'revoked_by' => $actor->id,
                'pairing_code_hash' => null,
                'pairing_code_expires_at' => null,
            ])->save();

            $revoked = self::deleteTokens($device);
            $this->audit->record('device.revoked', $device, new: ['tokens_revoked' => $revoked]);

            return $device;
        });
    }

    /** Deletes the terminal's own token and every cashier token issued on it. */
    public static function deleteTokens(Device $device): int
    {
        return PersonalAccessToken::query()
            ->where(fn ($q) => $q
                ->where(fn ($q) => $q->where('tokenable_type', $device->getMorphClass())->where('tokenable_id', $device->id))
                ->orWhere('device_id', $device->id))
            ->delete();
    }

    /** Codes are typed by people: ignore case, spaces and dashes. */
    public static function hashCode(string $code): string
    {
        return hash('sha256', strtoupper((string) preg_replace('/[\s-]+/', '', $code)));
    }
}
