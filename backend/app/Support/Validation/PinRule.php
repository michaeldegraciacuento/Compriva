<?php

namespace App\Support\Validation;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Cashier PIN policy: exactly 6 digits, not all the same digit and not a
 * simple ascending or descending run (123456, 987654).
 *
 * A PIN hash is stored on terminals for offline sign-in, so the PIN space
 * matters: 6 digits gives 10^6 combinations against bcrypt (cost 12).
 */
class PinRule implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! preg_match('/^\d{6}$/', $value)) {
            $fail('The PIN must be exactly 6 digits.');

            return;
        }

        $digits = array_map('intval', str_split($value));
        $steps = array_unique(array_map(fn ($a, $b) => $b - $a, array_slice($digits, 0, 5), array_slice($digits, 1)));

        if (count($steps) === 1 && in_array(reset($steps), [-1, 0, 1], true)) {
            $fail('The PIN is too easy to guess. Avoid repeated or sequential digits.');
        }
    }
}
