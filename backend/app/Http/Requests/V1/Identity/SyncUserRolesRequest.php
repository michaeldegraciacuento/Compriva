<?php

namespace App\Http\Requests\V1\Identity;

use Illuminate\Foundation\Http\FormRequest;

class SyncUserRolesRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'roles' => ['present', 'array'],
            'roles.*' => ['uuid', 'distinct', 'exists:roles,id'],
        ];
    }
}
