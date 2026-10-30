<?php

namespace App\Domain\Reporting;

/**
 * Decimal-string helpers for reports. Database sums of DECIMAL columns are
 * exact; these keep them exact (bcmath) while rounding for display.
 * No floating point.
 */
final class Dec
{
    private const SCALE = 8;

    /** Normalizes any numeric value (string, int, null) to a decimal string. */
    public static function of(mixed $value): string
    {
        return bcadd(($value === null || $value === '') ? '0' : (string) $value, '0', self::SCALE);
    }

    public static function add(mixed ...$values): string
    {
        return array_reduce($values, fn (string $sum, $v) => bcadd($sum, self::of($v), self::SCALE), '0');
    }

    public static function sub(mixed $a, mixed $b): string
    {
        return bcsub(self::of($a), self::of($b), self::SCALE);
    }

    /** Rounds half away from zero to $places decimals: round('2.345', 2) = "2.35". */
    public static function round(mixed $value, int $places): string
    {
        $value = self::of($value);
        $offset = '0.'.str_repeat('0', $places).'5';

        return bccomp($value, '0', self::SCALE) >= 0 ? bcadd($value, $offset, $places) : bcsub($value, $offset, $places);
    }

    /** Money for reports: 2 decimals. */
    public static function money(mixed $value): string
    {
        return self::round($value, 2);
    }

    /** Quantities: up to 4 decimals, trailing zeros removed. */
    public static function qty(mixed $value): string
    {
        $rounded = self::round($value, 4);

        return str_contains($rounded, '.') ? (rtrim(rtrim($rounded, '0'), '.') ?: '0') : $rounded;
    }

    /** part ÷ whole × 100 with one decimal, or null when the whole is zero. */
    public static function percent(mixed $part, mixed $whole): ?string
    {
        if (bccomp(self::of($whole), '0', self::SCALE) === 0) {
            return null;
        }

        return self::round(bcdiv(bcmul(self::of($part), '100', self::SCALE), self::of($whole), self::SCALE), 1);
    }

    public static function div(mixed $a, mixed $b, int $places = 2): ?string
    {
        if (bccomp(self::of($b), '0', self::SCALE) === 0) {
            return null;
        }

        return self::round(bcdiv(self::of($a), self::of($b), self::SCALE), $places);
    }

    /** "1234567.50" → "1,234,567.50" (for PDF and display). */
    public static function group(string $value): string
    {
        $negative = str_starts_with($value, '-');
        [$whole, $fraction] = array_pad(explode('.', ltrim($value, '-'), 2), 2, null);
        $grouped = strrev(implode(',', str_split(strrev($whole), 3)));

        return ($negative ? '-' : '').$grouped.($fraction !== null ? ".{$fraction}" : '');
    }
}
