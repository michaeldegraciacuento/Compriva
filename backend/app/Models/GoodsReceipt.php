<?php

namespace App\Models;

use App\Domain\Inventory\Enums\DocumentStatus;
use App\Models\Concerns\LockedWhenPosted;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Receiving document. Posting it creates stock batches and purchase_receipt movements. */
class GoodsReceipt extends Model
{
    use HasFactory, HasUuids, LockedWhenPosted;

    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class,
            'total_cost' => 'decimal:4',
            'received_at' => 'datetime',
            'posted_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(GoodsReceiptItem::class);
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }
}
