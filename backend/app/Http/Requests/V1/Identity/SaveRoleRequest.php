<?php

namespace App\Http\Requests\V1\Identity;

use App\Domain\Identity\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Create (POST) or update (PATCH) a role. `name` is a permanent slug set at creation. */
class SaveRoleRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        if ($this->isMethod('post')) {
            return [
                'name' => ['required', 'string', 'max:50', 'regex:/^[a-z][a-z0-9_]*$/', 'unique:roles,name'],
                'display_name' => ['required', 'string', 'max:100'],
                'description' => ['nullable', 'string', 'max:255'],
                'permissions' => ['present', 'array'],
                'permissions.*' => ['string', 'distinct', Rule::in(array_keys(Permissions::ALL))],
            ];
        }

        return [
            'display_name' => ['sometimes', 'required', 'string', 'max:100'],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
