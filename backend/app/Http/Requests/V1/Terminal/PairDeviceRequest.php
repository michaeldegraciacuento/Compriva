<?php

namespace App\Http\Requests\V1\Terminal;

use Illuminate\Foundation\Http\FormRequest;

class PairDeviceRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'pairing_code' => ['required', 'string', 'max:20'],
            'install_id' => ['required', 'uuid'],
            'machine_name' => ['nullable', 'string', 'max:100'],
            'os' => ['nullable', 'string', 'max:30'],
            'app_version' => ['nullable', 'string', 'max:30'],
        ];
    }
}
