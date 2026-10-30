<?php

namespace App\Http\Controllers\Api\V1\Catalog;

use App\Domain\Catalog\Actions\ManageBarcodes;
use App\Domain\Catalog\Actions\ManageProductImages;
use App\Domain\Catalog\Actions\ManageUnitConversions;
use App\Domain\Catalog\Actions\SaveProduct;
use App\Domain\Catalog\Actions\SetProductPrice;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Catalog\SaveProductRequest;
use App\Http\Requests\V1\Catalog\SaveSkuRequest;
use App\Http\Resources\V1\Catalog\CatalogResources;
use App\Http\Resources\V1\Catalog\ProductResource;
use App\Http\Resources\V1\Catalog\ProductSkuResource;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductImage;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\UnitConversion;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Products, SKUs, barcodes, unit conversions, prices and images.
 * Permissions per route group: products.view / products.manage / products.manage_prices.
 */
class ProductController extends Controller
{
    /** Everything the product screens show, loaded up front (no lazy loading). */
    private function detailRelations(): array
    {
        return [
            'category', 'brand', 'taxRate', 'images',
            'skus' => fn ($q) => $q->orderBy('code'),
            'skus.baseUnit', 'skus.barcodes.unit', 'skus.unitConversions.unit', 'skus.inventoryLevels',
            'skus.prices' => fn ($q) => $q->effectiveAt()->with('unit')->orderBy('tier'),
        ];
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'category_id' => ['nullable', 'uuid'],
            'brand_id' => ['nullable', 'uuid'],
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $products = Product::query()
            ->with($this->detailRelations())
            ->withCount('skus')
            ->when($filters['q'] ?? null, fn (Builder $q, string $term) => $q->where(fn (Builder $q) => $q
                ->where('name', 'like', "%{$term}%")
                ->orWhereHas('skus', fn (Builder $q) => $q->where('code', 'like', "%{$term}%")->orWhere('name', 'like', "%{$term}%"))
                ->orWhereHas('skus.barcodes', fn (Builder $q) => $q->where('barcode', $term))))
            ->when($filters['category_id'] ?? null, fn (Builder $q, string $id) => $q->where('category_id', $id))
            ->when($filters['brand_id'] ?? null, fn (Builder $q, string $id) => $q->where('brand_id', $id))
            ->when($filters['status'] ?? null, fn (Builder $q, string $status) => $q->where('is_active', $status === 'active'))
            ->orderBy('name')
            ->paginate($filters['per_page'] ?? 25);

        return ProductResource::collection($products);
    }

    public function store(SaveProductRequest $request, SaveProduct $save): JsonResponse
    {
        $product = $save->create($request->user(), $request->validated());

        return (new ProductResource($product->load($this->detailRelations())))->response()->setStatusCode(201);
    }

    public function show(Product $product): ProductResource
    {
        return new ProductResource($product->load($this->detailRelations()));
    }

    public function update(SaveProductRequest $request, Product $product, SaveProduct $save): ProductResource
    {
        return new ProductResource($save->update($product, $request->validated())->load($this->detailRelations()));
    }

    public function activate(Product $product, SaveProduct $save): ProductResource
    {
        return new ProductResource($save->setActive($product, true)->load($this->detailRelations()));
    }

    public function deactivate(Product $product, SaveProduct $save): ProductResource
    {
        return new ProductResource($save->setActive($product, false)->load($this->detailRelations()));
    }

    // --- SKUs ------------------------------------------------------------------

    /** Picker search for stock forms: by name, code or exact barcode. */
    public function searchSkus(Request $request): AnonymousResourceCollection
    {
        $term = $request->validate(['q' => ['nullable', 'string', 'max:100']])['q'] ?? '';

        $skus = ProductSku::query()
            ->with(['product', 'baseUnit', 'unitConversions.unit', 'inventoryLevels', 'barcodes'])
            ->whereHas('product', fn (Builder $q) => $q->where('track_inventory', true))
            ->when($term !== '', fn (Builder $q) => $q->where(fn (Builder $q) => $q
                ->where('name', 'like', "%{$term}%")
                ->orWhere('code', 'like', "%{$term}%")
                ->orWhereHas('barcodes', fn (Builder $q) => $q->where('barcode', $term))))
            ->orderBy('name')
            ->limit(20)
            ->get();

        return ProductSkuResource::collection($skus);
    }

    public function storeSku(SaveSkuRequest $request, Product $product, SaveProduct $save): JsonResponse
    {
        $sku = $save->addSku($request->user(), $product, $request->validated());

        return $this->skuResponse($sku, 201);
    }

    public function updateSku(SaveSkuRequest $request, ProductSku $sku, SaveProduct $save): JsonResponse
    {
        return $this->skuResponse($save->updateSku($sku, $request->validated()));
    }

    public function activateSku(ProductSku $sku, SaveProduct $save): JsonResponse
    {
        return $this->skuResponse($save->setSkuActive($sku, true));
    }

    public function deactivateSku(ProductSku $sku, SaveProduct $save): JsonResponse
    {
        return $this->skuResponse($save->setSkuActive($sku, false));
    }

    // --- Barcodes and unit conversions ------------------------------------------

    public function storeBarcode(Request $request, ProductSku $sku, ManageBarcodes $barcodes): JsonResponse
    {
        $data = $request->validate([
            'barcode' => ['required', 'string', 'max:64'],
            'type' => ['required', Rule::in(['ean13', 'ean8', 'upca', 'code128', 'internal'])],
            'unit_id' => ['nullable', 'uuid'],
            'is_primary' => ['sometimes', 'boolean'],
        ]);
        $barcodes->add($sku, $data);

        return $this->skuResponse($sku, 201);
    }

    public function destroyBarcode(ProductBarcode $barcode, ManageBarcodes $barcodes): Response
    {
        $barcodes->remove($barcode);

        return response()->noContent();
    }

    public function storeConversion(Request $request, ProductSku $sku, ManageUnitConversions $conversions): JsonResponse
    {
        $data = $request->validate([
            'unit_id' => ['required', 'uuid', Rule::exists('units', 'id')->where('is_active', true)],
            'factor' => ['required', 'numeric', 'gt:0', 'max:999999999', 'decimal:0,6'],
            'is_purchase_unit' => ['sometimes', 'boolean'],
            'is_sales_unit' => ['sometimes', 'boolean'],
        ]);
        $conversions->add($sku, $data);

        return $this->skuResponse($sku, 201);
    }

    public function updateConversion(Request $request, UnitConversion $conversion, ManageUnitConversions $conversions): JsonResponse
    {
        $data = $request->validate([
            'factor' => ['sometimes', 'numeric', 'gt:0', 'max:999999999', 'decimal:0,6'],
            'is_purchase_unit' => ['sometimes', 'boolean'],
            'is_sales_unit' => ['sometimes', 'boolean'],
        ]);
        $conversions->update($conversion, $data);

        return $this->skuResponse($conversion->sku);
    }

    public function destroyConversion(UnitConversion $conversion, ManageUnitConversions $conversions): Response
    {
        $conversions->remove($conversion);

        return response()->noContent();
    }

    // --- Prices ----------------------------------------------------------------

    public function prices(ProductSku $sku): JsonResponse
    {
        $history = $sku->prices()->with('unit')->orderByDesc('effective_from')->get();

        return response()->json(['data' => $history->map(fn (ProductPrice $p) => CatalogResources::price($p))->values()]);
    }

    public function storePrice(Request $request, ProductSku $sku, SetProductPrice $prices): JsonResponse
    {
        $data = $request->validate([
            'unit_id' => ['required', 'uuid'],
            'tier' => ['sometimes', Rule::in(['retail', 'wholesale', 'member'])],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999999', 'decimal:0,4'],
            'effective_from' => ['nullable', 'date', 'after_or_equal:now -1 minute'],
        ]);
        $price = $prices->set($request->user(), $sku, $data);

        return response()->json(['data' => CatalogResources::price($price->load('unit'))], 201);
    }

    // --- Images ----------------------------------------------------------------

    public function storeImage(Request $request, Product $product, ManageProductImages $images): JsonResponse
    {
        $request->validate([
            'image' => ['required', 'file', 'mimetypes:image/jpeg,image/png,image/webp', 'max:2048', 'dimensions:min_width=64,min_height=64,max_width=6000,max_height=6000'],
        ]);
        $images->upload($product, $request->file('image'));

        return (new ProductResource($product->load($this->detailRelations())))->response()->setStatusCode(201);
    }

    public function primaryImage(ProductImage $image, ManageProductImages $images): ProductResource
    {
        $images->makePrimary($image);

        return new ProductResource($image->product->load($this->detailRelations()));
    }

    public function destroyImage(ProductImage $image, ManageProductImages $images): Response
    {
        $images->delete($image);

        return response()->noContent();
    }

    /** Public: product photos are not sensitive, and <img> tags cannot send bearer tokens. */
    public function media(ProductImage $image): StreamedResponse
    {
        return Storage::disk(ManageProductImages::DISK)->response($image->path, null, [
            'Content-Type' => $image->mime_type,
            'Cache-Control' => 'public, max-age=86400, immutable',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function skuResponse(ProductSku $sku, int $status = 200): JsonResponse
    {
        $sku->load(['product', 'baseUnit', 'barcodes.unit', 'unitConversions.unit', 'inventoryLevels',
            'prices' => fn ($q) => $q->effectiveAt()->with('unit')]);

        return (new ProductSkuResource($sku))->response()->setStatusCode($status);
    }
}
