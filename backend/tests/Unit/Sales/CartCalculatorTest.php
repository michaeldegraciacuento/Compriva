<?php

namespace Tests\Unit\Sales;

use App\Domain\Sales\Pricing\CartCalculator;
use App\Domain\Sales\Pricing\FixedPoint;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Checkout arithmetic. The fixture cases are shared with the POS screen's calculator. */
class CartCalculatorTest extends TestCase
{
    /** @return array<string, array{array<string, mixed>}> */
    public static function sharedCases(): array
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../../../../shared/fixtures/checkout-calculations.json'), true, flags: JSON_THROW_ON_ERROR);

        return collect($fixture['cases'])->mapWithKeys(fn (array $case) => [$case['name'] => [$case]])->all();
    }

    #[DataProvider('sharedCases')]
    public function test_matches_the_shared_worked_examples(array $case): void
    {
        $result = (new CartCalculator)->calculate($case['lines'], $case['sale_discount'] ?? null);

        $lines = array_map(fn (array $line) => array_intersect_key($line, array_flip(['gross', 'discount', 'taxable', 'tax', 'total'])), $result['lines']);
        $this->assertSame($case['expected']['lines'], $lines);
        $this->assertSame($case['expected']['totals'], $result['totals']);
    }

    #[DataProvider('sharedCases')]
    public function test_totals_always_reconcile(array $case): void
    {
        $t = array_map(FixedPoint::cents(...), (new CartCalculator)->calculate($case['lines'], $case['sale_discount'] ?? null)['totals']);

        // Every centavo of the grand total is in exactly one tax bucket.
        $this->assertSame($t['grand_total'], $t['vatable_sales'] + $t['vat_amount'] + $t['vat_exempt_sales'] + $t['zero_rated_sales']);
        $this->assertGreaterThanOrEqual(0, $t['grand_total']);
    }

    public function test_rounding_is_half_up_on_exact_halves(): void
    {
        $this->assertSame(1, FixedPoint::divRound(1, 2));
        $this->assertSame(2, FixedPoint::divRound(3, 2));
        $this->assertSame(-2, FixedPoint::divRound(-3, 2));
        $this->assertSame(33, FixedPoint::divRound(100, 3));
    }

    public function test_allocation_always_adds_up_exactly(): void
    {
        $this->assertSame([334, 333, 333], FixedPoint::allocate(1000, [1, 1, 1]));
        $this->assertSame([0, 7], FixedPoint::allocate(7, [0, 5]));
        $this->assertSame([0, 0], FixedPoint::allocate(0, [3, 4]));

        foreach ([[999, [1, 2, 3, 4]], [1, [5, 5]], [12345, [17, 1, 999]]] as [$amount, $weights]) {
            $this->assertSame($amount, array_sum(FixedPoint::allocate($amount, $weights)));
        }
    }

    public function test_parsing_rejects_floats_in_disguise_and_excess_precision(): void
    {
        $this->assertSame(125_000, FixedPoint::parse('12.5'));
        $this->assertSame('1234.05', FixedPoint::format(123405));
        $this->assertSame('-0.07', FixedPoint::format(-7));

        foreach (['1e3', '0.12345', '', 'abc', '1,000'] as $bad) {
            try {
                FixedPoint::parse($bad);
                $this->fail("{$bad} should be rejected");
            } catch (\InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
