<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Collection;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUuids, Notifiable, SoftDeletes;

    /** Permission names, loaded once per request. @var Collection<int, string>|null */
    private ?Collection $permissionNames = null;

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'pin_hash',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'pin_hash' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(CashierShift::class, 'cashier_id');
    }

    /** @return Collection<int, string> */
    public function permissionNames(): Collection
    {
        return $this->permissionNames ??= Permission::query()
            ->whereHas('roles.users', fn (Builder $q) => $q->whereKey($this->getKey()))
            ->orderBy('name')
            ->pluck('name');
    }

    public function hasPermission(string $permission): bool
    {
        return $this->permissionNames()->contains($permission);
    }

    public function hasRole(string $role): bool
    {
        return $this->roles()->where('name', $role)->exists();
    }

    /** Call after changing the user's roles or a role's permissions. */
    public function flushPermissionCache(): void
    {
        $this->permissionNames = null;
    }

    public function scopeActive(Builder $query): void
    {
        $query->where('is_active', true);
    }

    /** Users holding a permission through any of their roles. */
    public function scopeWithPermission(Builder $query, string $permission): void
    {
        $query->whereHas('roles.permissions', fn (Builder $q) => $q->where('name', $permission));
    }
}
