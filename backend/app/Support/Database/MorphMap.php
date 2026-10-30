<?php

namespace App\Support\Database;

use App\Models;
use Illuminate\Database\Eloquent\Model;

/**
 * Stable aliases stored in polymorphic columns (stock_movements.reference_type,
 * audit_logs.auditable_type, personal_access_tokens.tokenable_type) and in
 * sync_changes.entity. Class names never reach the database, so models can be
 * renamed or moved without data migrations. Aliases must never change.
 */
final class MorphMap
{
    /** @var array<string, class-string<Model>> */
    public const MAP = [
        'user' => Models\User::class,
        'role' => Models\Role::class,
        'store' => Models\Store::class,
        'device' => Models\Device::class,
        'category' => Models\Category::class,
        'brand' => Models\Brand::class,
        'unit' => Models\Unit::class,
        'product' => Models\Product::class,
        'product_sku' => Models\ProductSku::class,
        'unit_conversion' => Models\UnitConversion::class,
        'product_barcode' => Models\ProductBarcode::class,
        'product_price' => Models\ProductPrice::class,
        'tax_rate' => Models\TaxRate::class,
        'discount' => Models\Discount::class,
        'customer' => Models\Customer::class,
        'supplier' => Models\Supplier::class,
        'purchase_order' => Models\PurchaseOrder::class,
        'goods_receipt' => Models\GoodsReceipt::class,
        'stock_adjustment' => Models\StockAdjustment::class,
        'stock_batch' => Models\StockBatch::class,
        'terminal_stock_allocation' => Models\TerminalStockAllocation::class,
        'payment_method' => Models\PaymentMethod::class,
        'cashier_shift' => Models\CashierShift::class,
        'cash_movement' => Models\CashMovement::class,
        'sale' => Models\Sale::class,
        'sale_item' => Models\SaleItem::class,
        'sale_return' => Models\SaleReturn::class,
        'sale_return_item' => Models\SaleReturnItem::class,
        'setting' => Models\Setting::class,
        'sync_conflict' => Models\SyncConflict::class,
    ];
}
