<?php

namespace App\Models;

use App\Domain\Devices\Enums\DeviceStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Laravel\Sanctum\HasApiTokens;

/** A checkout terminal. Authenticates with its own Sanctum token (Devices phase). */
class Device extends Model
{
    use HasApiTokens, HasFactory, HasUuids;

    protected $hidden = ['pairing_code_hash'];

    protected function casts(): array
    {
        return [
            'status' => DeviceStatus::class,
            'last_receipt_sequence' => 'integer',
            'pairing_code_expires_at' => 'datetime',
            'paired_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'last_synced_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(CashierShift::class);
    }

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class);
    }

    public function stockAllocations(): HasMany
    {
        return $this->hasMany(TerminalStockAllocation::class);
    }

    public function syncOperations(): HasMany
    {
        return $this->hasMany(SyncOperation::class);
    }

    public function syncCursors(): HasMany
    {
        return $this->hasMany(SyncCursor::class);
    }
}
