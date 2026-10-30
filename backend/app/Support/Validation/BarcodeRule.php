<?php

namespace App\Support\Validation;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validates a barcode for its symbology: length, digits and the GS1 check
 * digit for EAN-13, EAN-8 and UPC-A. Code 128 and internal codes accept
 * printable ASCII (4–64 characters).
 */
class BarcodeRule implements ValidationRule
{
    public function __construct(private readonly string $type) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $value = (string) $value;

        $length = match ($this->type) {
            'ean13' => 13,
            'ean8' => 8,
            'upca' => 12,
            default => null,
        };

        if ($length === null) {
            if (! preg_match('/^[\x21-\x7E]{4,64}$/', $value)) {
                $fail('Use 4–64 letters, digits or symbols without spaces.');
            }

            return;
        }

        if (! preg_match('/^\d{'.$length.'}$/', $value)) {
            $fail("A {$this->label()} barcode has exactly {$length} digits.");

            return;
        }

        if (! self::validCheckDigit($value)) {
            $fail("The check digit is wrong. Re-scan or re-type the {$this->label()} barcode.");
        }
    }

    /** GS1 mod-10: weights 3 and 1 alternating from the right, excluding the check digit. */
    public static function validCheckDigit(string $digits): bool
    {
        $body = substr($digits, 0, -1);
        $sum = 0;
        foreach (array_reverse(str_split($body)) as $i => $digit) {
            $sum += (int) $digit * ($i % 2 === 0 ? 3 : 1);
        }

        return (10 - $sum % 10) % 10 === (int) substr($digits, -1);
    }

    private function label(): string
    {
        return ['ean13' => 'EAN-13', 'ean8' => 'EAN-8', 'upca' => 'UPC-A'][$this->type];
    }
}
