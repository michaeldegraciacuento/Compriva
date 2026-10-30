<?php

namespace Database\Factories;

use App\Models\ProductSku;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\TaxRate;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * One line of 2 units at ₱56.00, VAT 12% inclusive, with a catalog snapshot.
 *
 * @extends Factory<SaleItem>
 */
class SaleItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'sale_id' => Sale::factory(),
            'line_number' => fn (array $a) => (int) SaleItem::where('sale_id', $a['sale_id'])->max('line_number') + 1,
            'product_sku_id' => ProductSku::factory(),
            'unit_id' => fn (array $a) => ProductSku::find($a['product_sku_id'])->base_unit_id,
            'product_name' => fn (array $a) => ProductSku::find($a['product_sku_id'])->name,
            'sku_code' => fn (array $a) => ProductSku::find($a['product_sku_id'])->code,
            'unit_name' => 'Piece',
            'conversion_factor' => '1.000000',
            'quantity' => '2.0000',
            'base_quantity' => '2.0000',
            'regular_unit_price' => '56.0000',
            'unit_price' => '56.0000',
            'unit_cost' => '45.0000',
            'gross_amount' => '112.0000',
            'tax_rate_id' => TaxRate::factory(),
            'tax_code' => 'VAT12',
            'tax_type' => 'vat',
            'tax_rate' => '12.0000',
            'taxable_amount' => '100.0000',
            'tax_amount' => '12.0000',
            'line_total' => '112.0000',
        ];
    }
}
