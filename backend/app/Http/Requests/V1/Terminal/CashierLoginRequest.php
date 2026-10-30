<?php

namespace App\Http\Requests\V1\Terminal;

use Illuminate\Foundation\Http\FormRequest;

class CashierLoginRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'username' => ['required', 'string', 'max:50'],
            'pin' => ['required', 'string', 'max:20'],
        ];
    }
}
