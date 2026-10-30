<?php

namespace App\Domain\Cashiering\Services;

use App\Domain\Devices\Enums\DeviceStatus;
use App\Models\Device;
use App\Models\Store;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The checkout terminal a POS request comes from.
 *
 * Every client sends its install ID in X-Compriva-Device: the desktop app's
 * from src-tauri/src/device.rs, the browser's from local storage. Shifts,
 * sales and receipt numbers belong to a terminal, so the POS works only on a
 * registered, active terminal. A user with devices.manage registers the
 * computer they are on with one click (POST /pos/terminal).
 */
class Terminals
{
    public const HEADER = 'X-Compriva-Device';

    public function __construct(private readonly AuditLogger $audit) {}

    public function installId(Request $request): ?string
    {
        $id = $request->header(self::HEADER);

        return is_string($id) && Str::isUuid($id) ? strtolower($id) : null;
    }

    /** The registered terminal for this client, or null. */
    public function current(Request $request): ?Device
    {
        $installId = $this->installId($request);

        return $installId === null ? null : Device::where('install_id', $installId)->first();
    }

    /** The active terminal for this client; throws TERMINAL_REQUIRED otherwise. */
    public function require(Request $request): Device
    {
        $device = $this->current($request);

        if ($device === null) {
            throw new BusinessException('This computer is not a checkout terminal yet. A manager can register it on the Point of Sale page.', ErrorCode::TerminalRequired, 409);
        }
        if ($device->status !== DeviceStatus::Active) {
            throw new BusinessException("Terminal {$device->code} has been revoked.", ErrorCode::DeviceRevoked, 403);
        }

        return $device;
    }

    /** Registers this client as the next terminal (T01, T02, …). */
    public function register(Request $request, string $name): Device
    {
        $installId = $this->installId($request)
            ?? throw new BusinessException('This app did not send a device ID, so it cannot become a terminal.', ErrorCode::BadRequest, 400);

        return DB::transaction(function () use ($installId, $name) {
            $existing = Device::where('install_id', $installId)->lockForUpdate()->first();
            if ($existing !== null) {
                throw new BusinessException("This computer is already terminal {$existing->code}.", ErrorCode::Conflict, 409, ['reason' => 'already_registered']);
            }

            $store = Store::query()->orderBy('created_at')->lockForUpdate()->firstOrFail();
            $used = Device::where('store_id', $store->id)->pluck('code')
                ->map(fn (string $code) => preg_match('/^T(\d+)$/', $code, $m) ? (int) $m[1] : 0)
                ->max() ?? 0;

            $device = Device::create([
                'store_id' => $store->id,
                'code' => sprintf('T%02d', $used + 1),
                'name' => $name,
                'install_id' => $installId,
                'status' => DeviceStatus::Active,
                'paired_at' => now(),
                'last_seen_at' => now(),
            ]);
            $this->audit->record('device.registered_as_terminal', $device, new: ['code' => $device->code, 'name' => $name]);

            return $device;
        });
    }
}
