<?php

namespace App\Http\Controllers\Api\V1\Identity;

use App\Domain\Identity\Actions\ChangePassword;
use App\Domain\Identity\Actions\ChangeUserStatus;
use App\Domain\Identity\Actions\CreateUser;
use App\Domain\Identity\Actions\RevokeUserAccess;
use App\Domain\Identity\Actions\SetUserPin;
use App\Domain\Identity\Actions\SyncUserRoles;
use App\Domain\Identity\Services\AccessControl;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Identity\ResetCredentialsRequest;
use App\Http\Requests\V1\Identity\StoreUserRequest;
use App\Http\Requests\V1\Identity\SyncUserRolesRequest;
use App\Http\Requests\V1\Identity\UpdateUserRequest;
use App\Http\Resources\V1\Identity\UserResource;
use App\Models\Role;
use App\Models\User;
use App\Support\Audit\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/** User management. Route group requires the `users.manage` permission. */
class UserController extends Controller
{
    public function __construct(private readonly AccessControl $access) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['active', 'suspended'])],
            'role' => ['nullable', 'string', 'exists:roles,name'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $users = User::query()
            ->with('roles')
            ->when($filters['q'] ?? null, fn ($q, $term) => $q->where(fn ($q) => $q
                ->where('name', 'like', "%{$term}%")
                ->orWhere('username', 'like', "%{$term}%")
                ->orWhere('email', 'like', "%{$term}%")))
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('is_active', $status === 'active'))
            ->when($filters['role'] ?? null, fn ($q, $role) => $q->whereHas('roles', fn ($q) => $q->where('name', $role)))
            ->orderBy('name')
            ->paginate($filters['per_page'] ?? 25);

        return UserResource::collection($users);
    }

    /**
     * Roles that can be given to users, for the user form. `grantable` is false
     * for roles with permissions the signed-in user does not have (the server
     * refuses those anyway). Separate from GET /roles, which needs roles.manage.
     */
    public function roleOptions(Request $request): JsonResponse
    {
        $mine = $request->user()->permissionNames();

        return response()->json(['data' => Role::with('permissions:id,name')->orderBy('display_name')->get()->map(fn (Role $role) => [
            'id' => $role->id,
            'name' => $role->name,
            'display_name' => $role->display_name,
            'description' => $role->description,
            'permissions_count' => $role->permissions->count(),
            'grantable' => $role->permissions->pluck('name')->diff($mine)->isEmpty(),
        ])->values()]);
    }

    public function store(StoreUserRequest $request, CreateUser $create): UserResource
    {
        $user = $create->execute($request->user(), $request->safe()->except('roles', 'password_confirmation'), $request->input('roles'));

        return new UserResource($user->load('roles'));
    }

    /** meta.manageable: whether the signed-in user may change this user (not someone with more access). */
    public function show(Request $request, User $user): UserResource
    {
        $actor = $request->user();

        return (new UserResource($user->load('roles')))->additional(['meta' => [
            'is_self' => $actor->is($user),
            'manageable' => $user->permissionNames()->diff($actor->permissionNames())->isEmpty(),
        ]]);
    }

    public function update(UpdateUserRequest $request, User $user, AuditLogger $audit): UserResource
    {
        $this->access->assertCanManage($request->user(), $user);

        $before = $user->only(array_keys($request->validated()));
        $user->update($request->validated());
        $audit->record('user.updated', $user, $before, $request->validated());

        return new UserResource($user->load('roles'));
    }

    public function roles(SyncUserRolesRequest $request, User $user, SyncUserRoles $sync): UserResource
    {
        $sync->execute($request->user(), $user, $request->input('roles'));

        return new UserResource($user->load('roles'));
    }

    public function suspend(Request $request, User $user, ChangeUserStatus $status): UserResource
    {
        $reason = $request->validate(['reason' => ['nullable', 'string', 'max:255']])['reason'] ?? null;

        return new UserResource($status->suspend($request->user(), $user, $reason)->load('roles'));
    }

    public function activate(Request $request, User $user, ChangeUserStatus $status): UserResource
    {
        return new UserResource($status->activate($request->user(), $user)->load('roles'));
    }

    /** Sets a new password and/or PIN. A password reset signs the user out everywhere. */
    public function credentials(ResetCredentialsRequest $request, User $user, ChangePassword $password, SetUserPin $pin): Response
    {
        $this->access->assertCanManage($request->user(), $user);

        if ($request->filled('password')) {
            $password->execute($user, $request->string('password')->toString(), byAdmin: true);
        }
        if ($request->exists('pin')) {
            $pin->execute($user, $request->input('pin'), byAdmin: true);
        }

        return response()->noContent();
    }

    /** Signs the user out of every session and terminal. */
    public function revokeAccess(Request $request, User $user, RevokeUserAccess $revoke, AuditLogger $audit): Response
    {
        $this->access->assertCanManage($request->user(), $user);

        $count = $revoke->execute($user);
        $audit->record('user.access_revoked', $user, new: ['revoked' => $count]);

        return response()->noContent();
    }
}
