<?php

namespace App\Domain\Sales\Pricing;

use InvalidArgumentException;

/**
 * Integer fixed-point helpers for checkout arithmetic. No floats anywhere:
 * decimals are parsed into integers (centavos, or 1/10000 units for quantities,
 * prices and rates), and every division rounds half up.
 *
 * Mirrored by frontend/src/modules/pos/fixed-point.ts; keep them identical.
 */
final class FixedPoint
{
    /** Scale for quantities, unit prices and rates: 4 decimals. */
    public const SCALE = 10_000;

    /** "12.5" → 125000 (4 decimals). Rejects more than 4 decimals and anything that is not a plain decimal. */
    public static function parse(string $value): int
    {
        if (! preg_match('/^(-)?(\d{1,13})(?:\.(\d{1,4}))?$/', trim($value), $m)) {
            throw new InvalidArgumentException("Not a decimal with up to 4 places: \"{$value}\"");
        }
        $units = (int) ($m[2].str_pad($m[3] ?? '', 4, '0'));

        return $m[1] === '-' ? -$units : $units;
    }

    /** Decimal string → centavos, rounding half up beyond 2 decimals. */
    public static function cents(string $value): int
    {
        return self::divRound(self::parse($value), 100);
    }

    /** A decimal string of any precision (e.g. a bcmul result) → centavos, half up. */
    public static function roundCents(string $value): int
    {
        if (! preg_match('/^(-)?(\d+)(?:\.(\d*))?$/', trim($value), $m)) {
            throw new InvalidArgumentException("Not a decimal: \"{$value}\"");
        }
        $fraction = str_pad($m[3] ?? '', 3, '0');
        $cents = (int) $m[2] * 100 + (int) substr($fraction, 0, 2) + ($fraction[2] >= '5' ? 1 : 0);

        return $m[1] === '-' ? -$cents : $cents;
    }

    /** 12345 → "123.45". */
    public static function format(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);

        return $sign.intdiv($cents, 100).'.'.str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }

    /** a ÷ b rounded half away from zero. b must be positive. */
    public static function divRound(int $a, int $b): int
    {
        if ($b <= 0) {
            throw new InvalidArgumentException('Divisor must be positive.');
        }
        $q = intdiv(abs($a) * 2 + $b, 2 * $b);

        return $a < 0 ? -$q : $q;
    }

    /**
     * Splits $amount centavos across lines in proportion to $weights (largest
     * remainder): the parts always add up to exactly $amount. Leftover centavos
     * go to the largest fractional parts, ties to the earlier line.
     *
     * @param  list<int>  $weights
     * @return list<int>
     */
    public static function allocate(int $amount, array $weights): array
    {
        $total = array_sum($weights);
        if ($total <= 0 || $amount === 0) {
            return array_fill(0, count($weights), 0);
        }

        $parts = [];
        $remainders = [];
        foreach ($weights as $i => $weight) {
            $parts[$i] = intdiv($amount * $weight, $total);
            $remainders[$i] = ($amount * $weight) % $total;
        }

        $left = $amount - array_sum($parts);
        $order = array_keys($remainders);
        usort($order, fn (int $a, int $b) => $remainders[$b] <=> $remainders[$a] ?: $a <=> $b);
        foreach (array_slice($order, 0, $left) as $i) {
            $parts[$i]++;
        }

        return $parts;
    }
}
