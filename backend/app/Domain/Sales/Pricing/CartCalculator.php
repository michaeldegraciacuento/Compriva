<?php

namespace App\Domain\Sales\Pricing;

use App\Domain\Sales\Enums\DiscountType;
use App\Domain\Settings\Enums\TaxType;

/**
 * Prices a cart: line amounts, discounts, VAT and sale totals.
 *
 * Pure and deterministic, integer centavos throughout (FixedPoint). The POS
 * screen runs the same algorithm (frontend/src/modules/pos/calculator.ts) so
 * the cashier sees the exact total the server will charge; both are tested
 * against shared/fixtures/checkout-calculations.json. Rules: docs/point-of-sale.md §3.
 *
 * Steps per line:
 *  1. gross = quantity × unit price, rounded to centavos
 *  2. item discount (percentage of gross, or a fixed amount capped at gross)
 *  3. sale discount share, split across lines in proportion to what is left
 *     (VAT-exempt discounts such as Senior Citizen / PWD first remove the VAT,
 *     then apply the percentage to the VAT-exclusive amount)
 *  4. VAT: extracted from VAT-inclusive prices, added to exclusive ones
 */
final class CartCalculator
{
    /**
     * @param  list<array{quantity: string, unit_price: string, tax_type: string, tax_rate: string, tax_inclusive: bool, discount?: ?array{type: string, value: string}}>  $lines
     * @param  ?array{type: string, value: string, vat_exempt?: bool, max_amount?: ?string}  $saleDiscount
     * @return array{lines: list<array{gross: string, item_discount: string, sale_discount: string, discount: string, taxable: string, tax: string, total: string, vat_exempted: bool}>, totals: array<string, string>}
     */
    public function calculate(array $lines, ?array $saleDiscount = null): array
    {
        $vatExempt = (bool) ($saleDiscount['vat_exempt'] ?? false);
        $rows = [];

        foreach ($lines as $line) {
            $gross = FixedPoint::divRound(FixedPoint::parse($line['quantity']) * FixedPoint::parse($line['unit_price']), FixedPoint::SCALE * 100);
            $itemDiscount = $this->discount($line['discount'] ?? null, $gross);
            $net = $gross - $itemDiscount;
            $type = TaxType::from($line['tax_type']);
            $rate = $type === TaxType::Vat ? FixedPoint::parse($line['tax_rate']) : 0;

            // Statutory (VAT-exempt) discounts are computed on the price without VAT.
            $base = $vatExempt && $type === TaxType::Vat && $line['tax_inclusive']
                ? FixedPoint::divRound($net * 1_000_000, 1_000_000 + $rate)
                : $net;

            $rows[] = compact('gross', 'itemDiscount', 'base', 'type', 'rate') + ['inclusive' => $line['tax_inclusive']];
        }

        $bases = array_column($rows, 'base');
        $saleAmount = $saleDiscount === null ? 0 : $this->discount($saleDiscount, array_sum($bases));
        if ($saleDiscount !== null && ($saleDiscount['max_amount'] ?? null) !== null) {
            $saleAmount = min($saleAmount, FixedPoint::cents($saleDiscount['max_amount']));
        }
        $shares = FixedPoint::allocate($saleAmount, $bases);

        $totals = array_fill_keys(['gross_amount', 'discount_total', 'vatable_sales', 'vat_amount', 'vat_exempt_sales', 'zero_rated_sales', 'grand_total'], 0);
        $out = [];

        foreach ($rows as $i => $row) {
            $amount = $row['base'] - $shares[$i];
            $exempted = $vatExempt && $row['type'] === TaxType::Vat;

            if ($row['type'] === TaxType::Vat && ! $exempted) {
                if ($row['inclusive']) {
                    $taxable = FixedPoint::divRound($amount * 1_000_000, 1_000_000 + $row['rate']);
                    $tax = $amount - $taxable;
                    $total = $amount;
                } else {
                    $taxable = $amount;
                    $tax = FixedPoint::divRound($amount * $row['rate'], FixedPoint::SCALE * 100);
                    $total = $amount + $tax;
                }
                $totals['vatable_sales'] += $taxable;
                $totals['vat_amount'] += $tax;
            } else {
                $taxable = $amount;
                $tax = 0;
                $total = $amount;
                $bucket = $row['type'] === TaxType::ZeroRated ? 'zero_rated_sales' : 'vat_exempt_sales';
                $totals[$bucket] += $total;
            }

            $discount = $row['itemDiscount'] + $shares[$i];
            $totals['gross_amount'] += $row['gross'];
            $totals['discount_total'] += $discount;
            $totals['grand_total'] += $total;

            $out[] = [
                'gross' => FixedPoint::format($row['gross']),
                'item_discount' => FixedPoint::format($row['itemDiscount']),
                'sale_discount' => FixedPoint::format($shares[$i]),
                'discount' => FixedPoint::format($discount),
                'taxable' => FixedPoint::format($taxable),
                'tax' => FixedPoint::format($tax),
                'total' => FixedPoint::format($total),
                'vat_exempted' => $exempted,
            ];
        }

        return ['lines' => $out, 'totals' => array_map(FixedPoint::format(...), $totals)];
    }

    /** Discount in centavos on $base centavos: a percentage, or a fixed amount capped at the base. */
    private function discount(?array $discount, int $base): int
    {
        if ($discount === null) {
            return 0;
        }

        return match (DiscountType::from($discount['type'])) {
            DiscountType::Percentage => min($base, FixedPoint::divRound($base * FixedPoint::parse($discount['value']), FixedPoint::SCALE * 100)),
            DiscountType::FixedAmount => min($base, FixedPoint::cents($discount['value'])),
        };
    }
}
