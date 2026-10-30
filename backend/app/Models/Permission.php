<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/** Code-defined permission (App\Domain\Identity\Permissions), synced to the table by the seeder. */
class Permission extends Model
{
    use HasFactory, HasUuids;

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class);
    }
}
