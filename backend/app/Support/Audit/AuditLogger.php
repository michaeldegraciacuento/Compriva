<?php

namespace App\Support\Audit;

use App\Http\Middleware\AssignRequestId;
use App\Models\AuditLog;
use App\Models\Device;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Writes security and business events to the append-only audit_logs table,
 * with the acting user or terminal, IP, user agent and request ID.
 * Secret values are always stripped before they are stored.
 */
class AuditLogger
{
    /** Attribute names whose values are never written to the audit log. */
    private const SECRET_KEYS = ['password', 'password_confirmation', 'current_password', 'pin', 'pin_hash',
        'pin_confirmation', 'remember_token', 'token', 'pairing_code', 'pairing_code_hash'];

    public function __construct(private readonly Request $request) {}

    /**
     * @param  array<string, mixed>  $old
     * @param  array<string, mixed>  $new
     */
    public function record(
        string $event,
        ?Model $subject = null,
        array $old = [],
        array $new = [],
        ?User $user = null,
        ?Device $device = null,
    ): AuditLog {
        $actor = $this->request->user();

        return AuditLog::create([
            'user_id' => $user?->id ?? ($actor instanceof User ? $actor->id : null),
            'device_id' => $device?->id ?? ($actor instanceof Device ? $actor->id : $this->tokenDeviceId($actor)),
            'event' => $event,
            'auditable_type' => $subject?->getMorphClass(),
            'auditable_id' => $subject?->getKey(),
            'old_values' => $old === [] ? null : self::redact($old),
            'new_values' => $new === [] ? null : self::redact($new),
            'ip_address' => $this->request->ip(),
            'user_agent' => mb_substr((string) $this->request->userAgent(), 0, 255) ?: null,
            'request_id' => $this->request->attributes->get(AssignRequestId::ATTRIBUTE),
            'created_at' => now(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    public static function redact(array $values): array
    {
        foreach ($values as $key => $value) {
            if (in_array($key, self::SECRET_KEYS, true)) {
                $values[$key] = '[redacted]';
            } elseif (is_array($value)) {
                $values[$key] = self::redact($value);
            }
        }

        return $values;
    }

    private function tokenDeviceId(?object $actor): ?string
    {
        if (! $actor instanceof User) {
            return null;
        }

        $token = $actor->currentAccessToken();

        return $token instanceof PersonalAccessToken ? $token->device_id : null;
    }
}
