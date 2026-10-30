<?php

namespace App\Http\Requests\V1\Devices;

use App\Models\Store;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Register (POST) or rename (PATCH) a terminal. */
class SaveDeviceRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        if ($this->isMethod('post')) {
            return [
                'store_id' => ['sometimes', 'uuid', 'exists:stores,id'],
                'code' => ['required', 'string', 'max:10', 'regex:/^[A-Za-z0-9-]+$/',
                    Rule::unique('devices', 'code')->where('store_id', $this->input('store_id', $this->defaultStoreId()))],
                'name' => ['required', 'string', 'max:100'],
            ];
        }

        return ['name' => ['required', 'string', 'max:100']];
    }

    public function defaultStoreId(): ?string
    {
        return Store::query()->orderBy('created_at')->value('id');
    }
}
