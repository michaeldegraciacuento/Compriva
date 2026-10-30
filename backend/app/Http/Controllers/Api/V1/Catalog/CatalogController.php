<?php

namespace App\Http\Controllers\Api\V1\Catalog;

use App\Domain\Catalog\Actions\ManageTaxonomy;
use App\Domain\Catalog\Enums\UnitType;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Catalog\CatalogResources;
use App\Models\Brand;
use App\Models\Category;
use App\Models\TaxRate;
use App\Models\Unit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Categories, brands, units and tax rates. Reading needs `products.view`,
 * changing needs `products.manage` (route groups).
 */
class CatalogController extends Controller
{
    public function __construct(private readonly ManageTaxonomy $taxonomy) {}

    // --- Categories ------------------------------------------------------------

    public function categories(): JsonResponse
    {
        $categories = Category::withCount('products')->orderBy('sort_order')->orderBy('name')->get();

        return response()->json(['data' => $categories->map(fn (Category $c) => $this->category($c))->values()]);
    }

    public function storeCategory(Request $request): JsonResponse
    {
        $category = $this->taxonomy->saveCategory(null, $this->validateCategory($request));

        return response()->json(['data' => $this->category($category->loadCount('products'))], 201);
    }

    public function updateCategory(Request $request, Category $category): JsonResponse
    {
        $category = $this->taxonomy->saveCategory($category, $this->validateCategory($request, $category));

        return response()->json(['data' => $this->category($category->loadCount('products'))]);
    }

    public function destroyCategory(Category $category): Response
    {
        $this->taxonomy->deleteCategory($category);

        return response()->noContent();
    }

    // --- Brands ----------------------------------------------------------------

    public function brands(): JsonResponse
    {
        $brands = Brand::withCount('products')->orderBy('name')->get();

        return response()->json(['data' => $brands->map(fn (Brand $b) => $this->brand($b))->values()]);
    }

    public function storeBrand(Request $request): JsonResponse
    {
        $brand = $this->taxonomy->saveBrand(null, $this->validateBrand($request));

        return response()->json(['data' => $this->brand($brand->loadCount('products'))], 201);
    }

    public function updateBrand(Request $request, Brand $brand): JsonResponse
    {
        $brand = $this->taxonomy->saveBrand($brand, $this->validateBrand($request, $brand));

        return response()->json(['data' => $this->brand($brand->loadCount('products'))]);
    }

    public function destroyBrand(Brand $brand): Response
    {
        $this->taxonomy->deleteBrand($brand);

        return response()->noContent();
    }

    // --- Units and tax rates ---------------------------------------------------

    public function units(): JsonResponse
    {
        $units = Unit::orderBy('type')->orderBy('name')->get();

        return response()->json(['data' => $units->map(fn (Unit $u) => CatalogResources::unit($u) + ['is_active' => $u->is_active])->values()]);
    }

    public function storeUnit(Request $request): JsonResponse
    {
        $unit = $this->taxonomy->saveUnit(null, $this->validateUnit($request));

        return response()->json(['data' => CatalogResources::unit($unit->refresh()) + ['is_active' => $unit->is_active]], 201);
    }

    public function updateUnit(Request $request, Unit $unit): JsonResponse
    {
        $unit = $this->taxonomy->saveUnit($unit, $this->validateUnit($request, $unit));

        return response()->json(['data' => CatalogResources::unit($unit) + ['is_active' => $unit->is_active]]);
    }

    public function taxRates(): JsonResponse
    {
        $rates = TaxRate::where('is_active', true)->orderByDesc('is_default')->orderBy('name')->get();

        return response()->json(['data' => $rates->map(fn (TaxRate $t) => [
            'id' => $t->id, 'code' => $t->code, 'name' => $t->name, 'type' => $t->type,
            'rate' => $t->rate, 'is_inclusive' => $t->is_inclusive, 'is_default' => $t->is_default,
        ])->values()]);
    }

    // --- Validation and shapes -------------------------------------------------

    /** @return array<string, mixed> */
    private function validateCategory(Request $request, ?Category $category = null): array
    {
        return $request->validate([
            'name' => [$category ? 'sometimes' : 'required', 'string', 'max:100'],
            'parent_id' => ['nullable', 'uuid', Rule::exists('categories', 'id')->whereNull('deleted_at'), Rule::notIn([$category?->id])],
            'description' => ['nullable', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:65535'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    /** @return array<string, mixed> */
    private function validateBrand(Request $request, ?Brand $brand = null): array
    {
        return $request->validate([
            'name' => [$brand ? 'sometimes' : 'required', 'string', 'max:100', Rule::unique('brands', 'name')->ignore($brand?->id)->whereNull('deleted_at')],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    /** @return array<string, mixed> */
    private function validateUnit(Request $request, ?Unit $unit = null): array
    {
        return $request->validate([
            'code' => [$unit ? 'sometimes' : 'required', 'string', 'max:20', 'regex:/^[a-z][a-z0-9_]*$/i', Rule::unique('units', 'code')->ignore($unit?->id)],
            'name' => [$unit ? 'sometimes' : 'required', 'string', 'max:50'],
            'type' => [$unit ? 'sometimes' : 'required', Rule::enum(UnitType::class)],
            'allows_decimal' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    /** @return array<string, mixed> */
    private function category(Category $c): array
    {
        return [
            'id' => $c->id, 'name' => $c->name, 'slug' => $c->slug, 'parent_id' => $c->parent_id,
            'description' => $c->description, 'sort_order' => $c->sort_order, 'is_active' => $c->is_active,
            'products_count' => $c->products_count ?? 0,
        ];
    }

    /** @return array<string, mixed> */
    private function brand(Brand $b): array
    {
        return ['id' => $b->id, 'name' => $b->name, 'slug' => $b->slug, 'is_active' => $b->is_active, 'products_count' => $b->products_count ?? 0];
    }
}
