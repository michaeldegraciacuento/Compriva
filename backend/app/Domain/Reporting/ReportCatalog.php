<?php

namespace App\Domain\Reporting;

use App\Domain\Reporting\Reports\CashierPerformanceReport;
use App\Domain\Reporting\Reports\CategorySalesReport;
use App\Domain\Reporting\Reports\CostOfGoodsSoldReport;
use App\Domain\Reporting\Reports\ExpiringProductsReport;
use App\Domain\Reporting\Reports\GrossProfitReport;
use App\Domain\Reporting\Reports\InventoryValuationReport;
use App\Domain\Reporting\Reports\PaymentSummaryReport;
use App\Domain\Reporting\Reports\ProductSalesReport;
use App\Domain\Reporting\Reports\SalesReport;
use App\Domain\Reporting\Reports\StockMovementReport;
use App\Models\User;
use Illuminate\Contracts\Container\Container;

/** Every report, in menu order. */
class ReportCatalog
{
    private const REPORTS = [
        SalesReport::class,
        ProductSalesReport::class,
        CategorySalesReport::class,
        GrossProfitReport::class,
        CostOfGoodsSoldReport::class,
        PaymentSummaryReport::class,
        CashierPerformanceReport::class,
        InventoryValuationReport::class,
        StockMovementReport::class,
        ExpiringProductsReport::class,
    ];

    public function __construct(private readonly Container $container) {}

    /** @return list<Report> reports the user may run */
    public function for(User $user): array
    {
        return array_values(array_filter(
            array_map(fn (string $class) => $this->container->make($class), self::REPORTS),
            fn (Report $report) => $user->hasPermission($report->permission()),
        ));
    }

    public function find(string $key): ?Report
    {
        foreach (self::REPORTS as $class) {
            $report = $this->container->make($class);
            if ($report->key() === $key) {
                return $report;
            }
        }

        return null;
    }
}
