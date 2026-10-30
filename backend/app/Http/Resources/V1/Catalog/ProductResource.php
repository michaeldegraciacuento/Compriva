<?php

namespace App\Http\Resources\V1\Catalog;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Product */
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $images = $this->relationLoaded('images') ? $this->images : null;
        $primary = $images?->firstWhere('is_primary', true) ?? $images?->first();

        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'category' => $this->whenLoaded('category', fn () => $this->category ? ['id' => $this->category->id, 'name' => $this->category->name] : null),
            'brand' => $this->whenLoaded('brand', fn () => $this->brand ? ['id' => $this->brand->id, 'name' => $this->brand->name] : null),
            'tax_rate' => $this->whenLoaded('taxRate', fn () => [
                'id' => $this->taxRate->id, 'code' => $this->taxRate->code, 'name' => $this->taxRate->name, 'rate' => $this->taxRate->rate,
            ]),
            'track_inventory' => $this->track_inventory,
            'track_batches' => $this->track_batches,
            'track_expiry' => $this->track_expiry,
            'is_active' => $this->is_active,
            'image_url' => $primary?->url(),
            'images' => $this->whenLoaded('images', fn () => $this->images->map(fn ($image) => [
                'id' => $image->id,
                'url' => $image->url(),
                'is_primary' => $image->is_primary,
                'width' => $image->width,
                'height' => $image->height,
                'size_bytes' => $image->size_bytes,
            ])->values()),
            'skus' => ProductSkuResource::collection($this->whenLoaded('skus')),
            'skus_count' => $this->whenCounted('skus'),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
