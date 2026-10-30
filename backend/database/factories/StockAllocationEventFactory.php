<?php

namespace Database\Factories;

use App\Models\StockAllocationEvent;
use App\Models\TerminalStockAllocation;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<StockAllocationEvent> */
class StockAllocationEventFactory extends Factory
{
    public function definition(): array
    {
        return [
            'terminal_stock_allocation_id' => TerminalStockAllocation::factory(),
            'type' => 'allocate',
            'quantity' => '20.0000',
            'occurred_at' => now(),
        ];
    }
}
