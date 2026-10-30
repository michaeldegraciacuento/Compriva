<?php

namespace App\Domain\Catalog\Actions;

use App\Models\Brand;
use App\Models\Category;
use App\Models\Unit;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Categories (a tree), brands and units of measure. Slugs are generated and
 * unique. Anything still referenced cannot be deleted.
 */
class ManageTaxonomy
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  array<string, mixed>  $data */
    public function saveCategory(?Category $category, array $data): Category
    {
        if ($category && isset($data['parent_id']) && $data['parent_id'] !== null) {
            $this->assertNotDescendant($category, $data['parent_id']);
        }
        if (isset($data['name'])) {
            $data['slug'] = $this->slug(Category::class, $data['name'], $category?->id);
        }

        $model = $category ? tap($category)->update($data) : Category::create($data);
        $this->audit->record($category ? 'category.updated' : 'category.created', $model, new: $data);

        return $model;
    }

    public function deleteCategory(Category $category): void
    {
        if ($category->products()->exists() || $category->children()->exists()) {
            throw new BusinessException('Move its products and sub-categories first.', ErrorCode::Conflict, 409, ['reason' => 'category_in_use']);
        }
        $category->delete();
        $this->audit->record('category.deleted', $category, ['name' => $category->name]);
    }

    /** @param  array<string, mixed>  $data */
    public function saveBrand(?Brand $brand, array $data): Brand
    {
        if (isset($data['name'])) {
            $data['slug'] = $this->slug(Brand::class, $data['name'], $brand?->id);
        }
        $model = $brand ? tap($brand)->update($data) : Brand::create($data);
        $this->audit->record($brand ? 'brand.updated' : 'brand.created', $model, new: $data);

        return $model;
    }

    public function deleteBrand(Brand $brand): void
    {
        if ($brand->products()->exists()) {
            throw new BusinessException('Products still use this brand.', ErrorCode::Conflict, 409, ['reason' => 'brand_in_use']);
        }
        $brand->delete();
        $this->audit->record('brand.deleted', $brand, ['name' => $brand->name]);
    }

    /** @param  array<string, mixed>  $data */
    public function saveUnit(?Unit $unit, array $data): Unit
    {
        if (isset($data['code'])) {
            $data['code'] = strtolower($data['code']);
        }
        $model = $unit ? tap($unit)->update($data) : Unit::create($data);
        $this->audit->record($unit ? 'unit.updated' : 'unit.created', $model, new: $data);

        return $model;
    }

    private function assertNotDescendant(Category $category, string $parentId): void
    {
        $cursor = Category::find($parentId);
        while ($cursor !== null) {
            if ($cursor->id === $category->id) {
                throw ValidationException::withMessages(['parent_id' => 'A category cannot be placed inside itself.']);
            }
            $cursor = $cursor->parent_id ? Category::find($cursor->parent_id) : null;
        }
    }

    /** @param  class-string<Category|Brand>  $model */
    private function slug(string $model, string $name, ?string $ignoreId): string
    {
        $base = Str::slug($name) ?: 'item';
        $slug = $base;
        for ($i = 2; $model::withTrashed()->where('slug', $slug)->when($ignoreId, fn ($q) => $q->whereKeyNot($ignoreId))->exists(); $i++) {
            $slug = "{$base}-{$i}";
        }

        return $slug;
    }
}
