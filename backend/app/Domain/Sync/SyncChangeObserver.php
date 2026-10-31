<?php

namespace App\Domain\Sync;

use App\Models\Category;
use App\Models\Customer;
use App\Models\Discount;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductImage;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\Setting;
use App\Models\Store;
use App\Models\TaxRate;
use App\Models\TerminalStockAllocation;
use App\Models\UnitConversion;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Records a sync change whenever data that terminals cache is saved or
 * deleted. Registered for each model in AppServiceProvider::OBSERVED_FOR_SYNC.
 */
class SyncChangeObserver
{
    public function saved(Model $model): void
    {
        $this->changed($model);
    }

    public function deleted(Model $model): void
    {
        $this->changed($model);
    }

    private function changed(Model $model): void
    {
        match (true) {
            $model instanceof ProductSku => SyncChanges::skus([$model->id]),
            $model instanceof Product => SyncChanges::skus($model->skus()->withTrashed()->pluck('id')),
            $model instanceof ProductPrice, $model instanceof ProductBarcode, $model instanceof UnitConversion => SyncChanges::skus([$model->product_sku_id]),
            $model instanceof ProductImage => SyncChanges::skus(ProductSku::withTrashed()->where('product_id', $model->product_id)->pluck('id')),
            $model instanceof TaxRate => SyncChanges::skus(ProductSku::whereHas('product', fn ($q) => $q->where('tax_rate_id', $model->id))->pluck('id')),
            $model instanceof Category => SyncChanges::record('catalog', 'category', $model->id),
            $model instanceof User => SyncChanges::cashiers($model->id),
            $model instanceof Customer => SyncChanges::record('customers', 'customer', $model->id),
            $model instanceof PaymentMethod => SyncChanges::record('settings', 'payment_method', $model->id),
            $model instanceof Discount => SyncChanges::record('settings', 'discount', $model->id),
            $model instanceof Setting, $model instanceof Store => SyncChanges::record('settings', $model->getMorphClass(), $model->id),
            $model instanceof TerminalStockAllocation => SyncChanges::record('allocations', 'terminal_stock_allocation', $model->id, $model->device_id),
            default => null,
        };
    }
}
