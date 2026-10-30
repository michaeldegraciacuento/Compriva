<?php

namespace App\Http\Resources\V1\Catalog;

use App\Models\ProductPrice;
use App\Models\Unit;

/**
 * Small shape helpers shared by the catalog resources (units and prices
 * appear nested in many places).
 */
final class CatalogResources
{
    /** @return array<string, mixed>|null */
    public static function unit(?Unit $unit): ?array
    {
        return $unit ? [
            'id' => $unit->id,
            'code' => $unit->code,
            'name' => $unit->name,
            'type' => $unit->type,
            'allows_decimal' => $unit->allows_decimal,
        ] : null;
    }

    /** @return array<string, mixed> */
    public static function price(ProductPrice $price): array
    {
        return [
            'id' => $price->id,
            'unit' => self::unit($price->unit),
            'tier' => $price->tier,
            'price' => $price->price,
            'effective_from' => $price->effective_from?->toIso8601ZuluString(),
            'effective_to' => $price->effective_to?->toIso8601ZuluString(),
        ];
    }
}
