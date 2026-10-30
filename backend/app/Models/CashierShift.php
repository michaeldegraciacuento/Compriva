<?php

namespace App\Models;

use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Support\Database\ImmutableRecordException;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A cashier's session on a terminal. At most one open shift per terminal
 * (unique open_device_key). Closed shifts are frozen; shifts are never deleted.
 */
class CashierShift extends Model
{
    use HasFactory, HasUuids;

    protected static function booted(): void
    {
        static::updating(function (self $shift) {
            if ($shift->getOriginal('status') === ShiftStatus::Closed) {
                throw ImmutableRecordException::forModel($shift, 'updated after closing');
            }
        });
        static::deleting(fn (self $shift) => throw ImmutableRecordException::forModel($shift, 'deleted'));
    }

    protected function casts(): array
    {
        return [
            'status' => ShiftStatus::class,
            'opening_float' => 'decimal:4',
            'expected_cash' => 'decimal:4',
            'counted_cash' => 'decimal:4',
            'cash_variance' => 'decimal:4',
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }

    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function cashMovements(): HasMany
    {
        return $this->hasMany(CashMovement::class);
    }

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class);
    }
}
