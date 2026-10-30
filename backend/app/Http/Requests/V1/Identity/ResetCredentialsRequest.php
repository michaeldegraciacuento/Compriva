<?php

namespace App\Http\Requests\V1\Identity;

use App\Support\Validation\PinRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\Validator;

/**
 * Administrator sets a new password and/or PIN. Send `"pin": null` to remove
 * a user's POS sign-in. At least one of the two must be present.
 */
class ResetCredentialsRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'password' => ['nullable', 'string', 'confirmed', Password::defaults()],
            'pin' => ['nullable', 'string', new PinRule],
        ];
    }

    /** @return list<callable> */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                if (! $this->filled('password') && ! $this->exists('pin')) {
                    $validator->errors()->add('password', 'Provide a new password, a PIN, or both.');
                }
            },
        ];
    }
}
