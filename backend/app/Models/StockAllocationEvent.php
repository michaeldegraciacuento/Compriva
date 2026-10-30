<?php

namespace App\Models;

use App\Domain\Inventory\Enums\AllocationEventType;
use App\Models\Concerns\AppendOnly;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockAllocationEvent extends Model
{
    use AppendOnly, HasFactory, HasUuids;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'type' => AllocationEventType::class,
            'quantity' => 'decimal:4',
            'occurred_at' => 'datetime',
        ];
    }

    public function allocation(): BelongsTo
    {
        return $this->belongsTo(TerminalStockAllocation::class, 'terminal_stock_allocation_id');
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
