<?php

namespace App\Http\Requests\V1\Auth;

use App\Support\Validation\PinRule;
use Illuminate\Foundation\Http\FormRequest;

/** Setting your own PIN requires your password (the PIN is a weaker secret). */
class ChangePinRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'current_password' => ['required', 'string', 'current_password'],
            'pin' => ['required', 'string', 'confirmed', new PinRule],
        ];
    }
}
