<?php

namespace App\Models;

use App\Domain\Inventory\Enums\AdjustmentReason;
use App\Domain\Inventory\Enums\DocumentStatus;
use App\Domain\Inventory\Enums\StockDocumentType;
use App\Models\Concerns\LockedWhenPosted;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockAdjustment extends Model
{
    use HasFactory, HasUuids, LockedWhenPosted;

    protected function casts(): array
    {
        return [
            'type' => StockDocumentType::class,
            'reason' => AdjustmentReason::class,
            'status' => DocumentStatus::class,
            'posted_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(StockAdjustmentItem::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
