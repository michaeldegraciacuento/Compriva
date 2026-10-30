<?php

namespace Database\Factories;

use App\Models\ProductBarcode;
use App\Models\ProductSku;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ProductBarcode> */
class ProductBarcodeFactory extends Factory
{
    public function definition(): array
    {
        return [
            'product_sku_id' => ProductSku::factory(),
            'barcode' => fake()->unique()->ean13(),
            'type' => 'ean13',
            'is_primary' => true,
        ];
    }
}
