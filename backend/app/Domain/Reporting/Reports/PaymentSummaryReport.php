<?php

namespace App\Domain\Reporting\Reports;

use App\Domain\Reporting\Dec;
use App\Domain\Reporting\Report;
use App\Domain\Reporting\ReportFilters;
use App\Domain\Reporting\ReportResult;
use Illuminate\Support\Facades\DB;

/** Takings per payment method: Cash, GCash, Maya, minus refunds paid with each. */
class PaymentSummaryReport extends Report
{
    public function key(): string
    {
        return 'payment-summary';
    }

    public function title(): string
    {
        return 'Payment summary';
    }

    public function description(): string
    {
        return 'Payments and refunds per method (Cash, GCash, Maya) and each method\'s share.';
    }

    public function build(ReportFilters $filters): ReportResult
    {
        $range = [$filters->fromDate(), $filters->toDate()];

        $payments = DB::table('payments')->join('sales', 'sales.id', '=', 'payments.sale_id')
            ->where('sales.status', 'completed')->whereBetween('sales.business_date', $range)
            ->groupBy('payments.method_code')
            ->selectRaw('payments.method_code AS method, COUNT(*) AS count, SUM(payments.amount) AS amount, SUM(payments.change_amount) AS change_given')
            ->get()->keyBy('method');
        $refunds = DB::table('refunds')->join('sale_returns', 'sale_returns.id', '=', 'refunds.sale_return_id')
            ->whereBetween('sale_returns.business_date', $range)
            ->groupBy('refunds.method_code')->selectRaw('refunds.method_code AS method, SUM(refunds.amount) AS amount')
            ->pluck('amount', 'method');
        $names = DB::table('payment_methods')->pluck('name', 'code');

        $order = ['cash' => 0, 'gcash' => 1, 'maya' => 2];
        $methods = $payments->keys()->merge($refunds->keys())->unique()->sortBy(fn (string $code) => $order[$code] ?? 99);
        $totalNet = Dec::sub(Dec::add(...$payments->pluck('amount')->all()), Dec::add(...$refunds->values()->all()));

        $sum = ['count' => 0, 'amount' => '0', 'refunds' => '0', 'change' => '0'];
        $rows = $methods->map(function (string $code) use ($payments, $refunds, $names, $totalNet, &$sum) {
            $p = $payments->get($code);
            $net = Dec::sub($p->amount ?? 0, $refunds[$code] ?? 0);
            $sum['count'] += (int) ($p->count ?? 0);
            $sum['amount'] = Dec::add($sum['amount'], $p->amount ?? 0);
            $sum['refunds'] = Dec::add($sum['refunds'], $refunds[$code] ?? 0);
            $sum['change'] = Dec::add($sum['change'], $p->change_given ?? 0);

            return [
                'method' => $names[$code] ?? $code,
                'payments' => (int) ($p->count ?? 0),
                'amount' => Dec::money($p->amount ?? 0),
                'change_given' => Dec::money($p->change_given ?? 0),
                'refunds' => Dec::money($refunds[$code] ?? 0),
                'net' => Dec::money($net),
                'share' => Dec::percent($net, $totalNet),
            ];
        })->values()->all();

        return new ReportResult(
            $this->key(), $this->title(), $filters->rangeLabel(),
            [
                self::col('method', 'Method'),
                self::col('payments', 'Payments', 'int'),
                self::col('amount', 'Collected', 'money'),
                self::col('change_given', 'Change given', 'money'),
                self::col('refunds', 'Refunded', 'money'),
                self::col('net', 'Net', 'money'),
                self::col('share', 'Share', 'percent'),
            ],
            $rows,
            [
                'method' => 'Total', 'payments' => $sum['count'], 'amount' => Dec::money($sum['amount']), 'change_given' => Dec::money($sum['change']),
                'refunds' => Dec::money($sum['refunds']), 'net' => Dec::money(Dec::sub($sum['amount'], $sum['refunds'])), 'share' => $rows === [] ? null : '100.0',
            ],
            ['Collected is what each sale kept (cash tendered minus change). Split payments count once per method. Voided sales are excluded.'],
        );
    }
}
