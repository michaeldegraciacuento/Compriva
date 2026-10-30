<?php

namespace App\Domain\Catalog\Actions;

use App\Models\Product;
use App\Models\ProductImage;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Product photos on the local disk (storage/app/private/products), served by
 * GET /api/v1/media/product-images/{id}. The first image becomes primary.
 */
class ManageProductImages
{
    public const MAX_IMAGES = 8;

    public const DISK = 'local';

    public function __construct(private readonly AuditLogger $audit) {}

    public function upload(Product $product, UploadedFile $file): ProductImage
    {
        if ($product->images()->count() >= self::MAX_IMAGES) {
            throw new BusinessException('A product can have up to '.self::MAX_IMAGES.' images.', ErrorCode::BusinessRuleViolation, 422, ['reason' => 'too_many_images']);
        }

        $extension = match ($file->getMimeType()) {
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'jpg',
        };
        $path = $file->storeAs('products', Str::uuid7().'.'.$extension, self::DISK);
        [$width, $height] = @getimagesize($file->getRealPath()) ?: [null, null];

        try {
            return DB::transaction(function () use ($product, $file, $path, $width, $height) {
                $first = ! $product->images()->exists();
                $image = $product->images()->create([
                    'path' => $path,
                    'mime_type' => $file->getMimeType(),
                    'size_bytes' => $file->getSize(),
                    'width' => $width,
                    'height' => $height,
                    'is_primary' => $first,
                    'sort_order' => (int) $product->images()->max('sort_order') + 1,
                ]);
                $this->audit->record('product_image.added', $product, new: ['image_id' => $image->id]);

                return $image;
            });
        } catch (\Throwable $e) {
            Storage::disk(self::DISK)->delete($path); // no orphan files when the row is not written

            throw $e;
        }
    }

    public function makePrimary(ProductImage $image): ProductImage
    {
        DB::transaction(function () use ($image) {
            ProductImage::where('product_id', $image->product_id)->update(['is_primary' => false]);
            $image->update(['is_primary' => true]);
        });

        return $image;
    }

    public function delete(ProductImage $image): void
    {
        DB::transaction(function () use ($image) {
            $image->delete();
            if ($image->is_primary) {
                ProductImage::where('product_id', $image->product_id)->orderBy('sort_order')->first()?->update(['is_primary' => true]);
            }
            $this->audit->record('product_image.removed', $image->product, ['image_id' => $image->id]);
        });

        Storage::disk(self::DISK)->delete($image->path);
    }
}
