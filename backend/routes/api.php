<?php

use App\Http\Controllers\Api\V1\Auth\ProfileController;
use App\Http\Controllers\Api\V1\Auth\SessionController;
use App\Http\Controllers\Api\V1\Auth\TokenController;
use App\Http\Controllers\Api\V1\Catalog\CatalogController;
use App\Http\Controllers\Api\V1\Catalog\ProductController;
use App\Http\Controllers\Api\V1\Dashboard\StockAlertController;
use App\Http\Controllers\Api\V1\Devices\DeviceController;
use App\Http\Controllers\Api\V1\Identity\RoleController;
use App\Http\Controllers\Api\V1\Identity\UserController;
use App\Http\Controllers\Api\V1\Inventory\InventoryController;
use App\Http\Controllers\Api\V1\Purchasing\PurchasingController;
use App\Http\Controllers\Api\V1\Reports\ReportController;
use App\Http\Controllers\Api\V1\Sales\PaymentMethodController;
use App\Http\Controllers\Api\V1\Sales\PosController;
use App\Http\Controllers\Api\V1\Sales\SaleController;
use App\Http\Controllers\Api\V1\Sales\ShiftController;
use App\Http\Controllers\Api\V1\Sync\SyncController;
use App\Http\Controllers\Api\V1\Sync\TerminalsController;
use App\Http\Controllers\Api\V1\System\HealthController;
use App\Http\Controllers\Api\V1\Terminal\TerminalController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API routes — all endpoints are versioned under /api/v1
|--------------------------------------------------------------------------
|
| Every route that is not public requires authentication (auth:sanctum) and
| an actor check: `actor.user` (an active person) or `actor.device` (an active
| terminal). Permission checks use `can:<permission>` and run on the server.
| Conventions: docs/api-conventions.md, docs/authentication.md
|
*/

Route::prefix('v1')->name('api.v1.')->group(function () {
    // Public
    Route::get('health', HealthController::class)->name('health');
    Route::post('auth/login', [SessionController::class, 'store'])->middleware('throttle:login')->name('auth.login');
    Route::post('auth/token', [SessionController::class, 'token'])->middleware('throttle:login')->name('auth.token');
    Route::post('terminal/pair', [TerminalController::class, 'pair'])->middleware('throttle:pairing')->name('terminal.pair');
    // Product photos for <img> tags (no bearer token possible; images are not sensitive).
    Route::get('media/product-images/{image}', [ProductController::class, 'media'])->name('media.product-image');
    // GCash / Maya QR codes shown to customers at the counter.
    Route::get('media/payment-qr/{method}', [PaymentMethodController::class, 'media'])->name('media.payment-qr');

    Route::middleware('auth:sanctum')->group(function () {
        // Checkout terminals (device token)
        Route::middleware('actor.device')->prefix('terminal')->name('terminal.')->group(function () {
            Route::get('device', [TerminalController::class, 'device'])->name('device');
            Route::post('login', [TerminalController::class, 'login'])->middleware('throttle:terminal-login')->name('login');
            Route::get('cashiers', [TerminalController::class, 'cashiers'])->name('cashiers');
        });

        // Synchronization (desktop terminals, device token): docs/offline-sync.md.
        Route::middleware('actor.device')->prefix('sync')->name('sync.')->controller(SyncController::class)->group(function () {
            Route::post('operations', 'push')->middleware('throttle:sync')->name('push');
            Route::get('changes', 'changes')->name('changes');
            Route::post('allocations/top-up', 'topUp')->name('allocations.top-up');
        });

        // People (web session or cashier token)
        Route::middleware('actor.user')->group(function () {
            Route::prefix('auth')->name('auth.')->group(function () {
                Route::get('me', [SessionController::class, 'show'])->name('me');
                Route::post('logout', [SessionController::class, 'destroy'])->name('logout');
                Route::patch('profile', [ProfileController::class, 'update'])->name('profile');
                Route::put('password', [ProfileController::class, 'password'])->name('password');
                Route::put('pin', [ProfileController::class, 'pin'])->name('pin');
                Route::get('tokens', [TokenController::class, 'index'])->name('tokens.index');
                Route::delete('tokens/{token}', [TokenController::class, 'destroy'])->whereNumber('token')->name('tokens.destroy');
            });

            // Permission (dashboard.view or inventory.view) is checked in the controller.
            Route::get('dashboard/stock-alerts', StockAlertController::class)->name('dashboard.stock-alerts');

            // Catalog: products, SKUs, barcodes, units, prices, images (docs/products-inventory.md).
            Route::middleware('can:products.view')->group(function () {
                Route::get('categories', [CatalogController::class, 'categories'])->name('categories.index');
                Route::get('brands', [CatalogController::class, 'brands'])->name('brands.index');
                Route::get('units', [CatalogController::class, 'units'])->name('units.index');
                Route::get('tax-rates', [CatalogController::class, 'taxRates'])->name('tax-rates.index');
                Route::get('products', [ProductController::class, 'index'])->name('products.index');
                Route::get('products/{product}', [ProductController::class, 'show'])->name('products.show');
                Route::get('skus/search', [ProductController::class, 'searchSkus'])->name('skus.search');
                Route::get('skus/{sku}/prices', [ProductController::class, 'prices'])->name('skus.prices.index');
            });
            Route::middleware('can:products.manage')->group(function () {
                Route::post('categories', [CatalogController::class, 'storeCategory'])->name('categories.store');
                Route::patch('categories/{category}', [CatalogController::class, 'updateCategory'])->name('categories.update');
                Route::delete('categories/{category}', [CatalogController::class, 'destroyCategory'])->name('categories.destroy');
                Route::post('brands', [CatalogController::class, 'storeBrand'])->name('brands.store');
                Route::patch('brands/{brand}', [CatalogController::class, 'updateBrand'])->name('brands.update');
                Route::delete('brands/{brand}', [CatalogController::class, 'destroyBrand'])->name('brands.destroy');
                Route::post('units', [CatalogController::class, 'storeUnit'])->name('units.store');
                Route::patch('units/{unit}', [CatalogController::class, 'updateUnit'])->name('units.update');

                Route::controller(ProductController::class)->group(function () {
                    Route::post('products', 'store')->name('products.store');
                    Route::patch('products/{product}', 'update')->name('products.update');
                    Route::post('products/{product}/activate', 'activate')->name('products.activate');
                    Route::post('products/{product}/deactivate', 'deactivate')->name('products.deactivate');
                    Route::post('products/{product}/skus', 'storeSku')->name('skus.store');
                    Route::patch('skus/{sku}', 'updateSku')->name('skus.update');
                    Route::post('skus/{sku}/activate', 'activateSku')->name('skus.activate');
                    Route::post('skus/{sku}/deactivate', 'deactivateSku')->name('skus.deactivate');
                    Route::post('skus/{sku}/barcodes', 'storeBarcode')->name('barcodes.store');
                    Route::delete('barcodes/{barcode}', 'destroyBarcode')->name('barcodes.destroy');
                    Route::post('skus/{sku}/conversions', 'storeConversion')->name('conversions.store');
                    Route::patch('conversions/{conversion}', 'updateConversion')->name('conversions.update');
                    Route::delete('conversions/{conversion}', 'destroyConversion')->name('conversions.destroy');
                    Route::post('products/{product}/images', 'storeImage')->name('product-images.store');
                    Route::post('product-images/{image}/primary', 'primaryImage')->name('product-images.primary');
                    Route::delete('product-images/{image}', 'destroyImage')->name('product-images.destroy');
                });
            });
            Route::post('skus/{sku}/prices', [ProductController::class, 'storePrice'])->middleware('can:products.manage_prices')->name('skus.prices.store');

            // Inventory: every stock change goes through the StockLedger (docs/products-inventory.md).
            Route::prefix('inventory')->name('inventory.')->controller(InventoryController::class)->group(function () {
                Route::middleware('can:inventory.view')->group(function () {
                    Route::get('stock', 'stock')->name('stock');
                    Route::get('documents', 'documents')->name('documents.index');
                    Route::get('documents/{document}', 'showDocument')->name('documents.show');
                    Route::get('movements', 'movements')->name('movements');
                    Route::get('batches', 'batches')->name('batches');
                });
                Route::middleware('can:inventory.adjust')->group(function () {
                    Route::post('stock-in', 'stockIn')->name('stock-in');
                    Route::post('stock-out', 'stockOut')->name('stock-out');
                    Route::post('adjustments', 'adjustment')->name('adjustments');
                    Route::delete('documents/{document}', 'reject')->name('documents.reject');
                });
                Route::post('documents/{document}/approve', 'approve')->middleware('can:inventory.approve')->name('documents.approve');
            });

            // Point of sale: the terminal is identified by X-Compriva-Device (docs/point-of-sale.md).
            Route::middleware('can:pos.access')->prefix('pos')->name('pos.')->controller(PosController::class)->group(function () {
                Route::get('terminal', 'bootstrap')->name('bootstrap');
                Route::post('terminal', 'registerTerminal')->middleware('can:devices.manage')->name('terminal.register');
                Route::post('terminal/sync-token', 'syncToken')->name('terminal.sync-token');
                Route::get('shift', 'shift')->name('shift');
                Route::post('shift', 'openShift')->name('shift.open');
                Route::post('shift/close', 'closeShift')->name('shift.close');
                Route::post('cash-movements', 'cashMovement')->name('cash-movements.store');
                Route::get('catalog', 'catalog')->name('catalog');
                Route::post('quote', 'quote')->name('quote');
                Route::post('checkout', 'checkout')->name('checkout');
                Route::get('sales', 'sales')->name('sales');
            });

            // Completed sales are never edited; void and return create new records. Permissions:
            // show/void/returns accept the POS user and check approvals in the domain actions.
            Route::prefix('sales')->name('sales.')->controller(SaleController::class)->group(function () {
                Route::get('/', 'index')->middleware('can:sales.view')->name('index');
                Route::get('{sale}', 'show')->name('show');
                Route::post('{sale}/reprint', 'reprint')->middleware('can:sales.reprint')->name('reprint');
                Route::post('{sale}/void', 'void')->name('void');
                Route::post('{sale}/returns', 'storeReturn')->name('returns.store');
            });

            Route::middleware('can:cashier.manage_shifts')->prefix('shifts')->name('shifts.')->controller(ShiftController::class)->group(function () {
                Route::get('/', 'index')->name('index');
                Route::get('{shift}', 'show')->name('show');
            });

            // Purchasing: suppliers, purchase orders, receiving (docs/purchasing-cashier-reports.md).
            Route::controller(PurchasingController::class)->group(function () {
                Route::middleware('can:purchasing.view')->group(function () {
                    Route::get('suppliers', 'suppliers')->name('suppliers.index');
                    Route::get('purchase-orders', 'orders')->name('purchase-orders.index');
                    Route::get('purchase-orders/{order}', 'showOrder')->name('purchase-orders.show');
                    Route::get('goods-receipts', 'receipts')->name('goods-receipts.index');
                    Route::get('goods-receipts/{receipt}', 'showReceipt')->name('goods-receipts.show');
                    Route::get('skus/{sku}/cost-history', 'costHistory')->name('skus.cost-history');
                });
                Route::middleware('can:purchasing.manage')->group(function () {
                    Route::post('suppliers', 'storeSupplier')->name('suppliers.store');
                    Route::patch('suppliers/{supplier}', 'updateSupplier')->name('suppliers.update');
                    Route::post('purchase-orders', 'storeOrder')->name('purchase-orders.store');
                    Route::put('purchase-orders/{order}', 'updateOrder')->name('purchase-orders.update');
                    Route::post('purchase-orders/{order}/cancel', 'cancelOrder')->name('purchase-orders.cancel');
                });
                Route::post('purchase-orders/{order}/approve', 'approveOrder')->middleware('can:purchasing.approve')->name('purchase-orders.approve');
                Route::post('purchase-orders/{order}/receive', 'receive')->middleware('can:purchasing.receive')->name('purchase-orders.receive');
            });

            // Reports: JSON, or ?format=csv|xlsx|pdf. Profit needs reports.view_profit (checked per report).
            Route::middleware('can:reports.view')->prefix('reports')->name('reports.')->group(function () {
                Route::get('/', [ReportController::class, 'index'])->name('index');
                Route::get('{key}', [ReportController::class, 'show'])->name('show');
            });

            // Terminals, stock allocations and sync conflicts (managers).
            Route::middleware('can:inventory.allocate')->controller(TerminalsController::class)->group(function () {
                Route::get('terminals', 'index')->name('terminals.index');
                Route::get('terminals/{device}', 'show')->name('terminals.show');
                Route::post('terminals/{device}/allocations', 'allocate')->name('terminals.allocate');
                Route::get('sync/conflicts', 'conflicts')->name('sync.conflicts.index');
                Route::post('sync/conflicts/{conflict}/resolve', 'resolve')->name('sync.conflicts.resolve');
            });

            Route::get('payment-methods', [PaymentMethodController::class, 'index'])->name('payment-methods.index');
            Route::middleware('can:payments.manage_methods')->controller(PaymentMethodController::class)->group(function () {
                Route::patch('payment-methods/{method}', 'update')->name('payment-methods.update');
                Route::post('payment-methods/{method}/qr', 'uploadQr')->name('payment-methods.qr.store');
                Route::delete('payment-methods/{method}/qr', 'removeQr')->name('payment-methods.qr.destroy');
            });

            Route::middleware('can:users.manage')->prefix('users')->name('users.')->controller(UserController::class)->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->name('store');
                Route::get('{user}', 'show')->name('show');
                Route::patch('{user}', 'update')->name('update');
                Route::put('{user}/roles', 'roles')->name('roles');
                Route::post('{user}/suspend', 'suspend')->name('suspend');
                Route::post('{user}/activate', 'activate')->name('activate');
                Route::put('{user}/credentials', 'credentials')->name('credentials');
                Route::delete('{user}/access', 'revokeAccess')->name('revoke-access');
            });

            Route::middleware('can:roles.manage')->controller(RoleController::class)->group(function () {
                Route::get('permissions', 'permissionCatalog')->name('permissions.index');
                Route::get('roles', 'index')->name('roles.index');
                Route::post('roles', 'store')->name('roles.store');
                Route::get('roles/{role}', 'show')->name('roles.show');
                Route::patch('roles/{role}', 'update')->name('roles.update');
                Route::put('roles/{role}/permissions', 'permissions')->name('roles.permissions');
                Route::delete('roles/{role}', 'destroy')->name('roles.destroy');
            });

            Route::middleware('can:devices.manage')->prefix('devices')->name('devices.')->controller(DeviceController::class)->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->name('store');
                Route::get('{device}', 'show')->name('show');
                Route::patch('{device}', 'update')->name('update');
                Route::post('{device}/pairing-code', 'pairingCode')->name('pairing-code');
                Route::post('{device}/revoke', 'revoke')->name('revoke');
            });
        });
    });
});
