<?php

namespace App\Http\Controllers\Api\V1\Identity;

use App\Domain\Identity\Actions\SaveRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Identity\SaveRoleRequest;
use App\Http\Requests\V1\Identity\SyncRolePermissionsRequest;
use App\Http\Resources\V1\Identity\PermissionResource;
use App\Http\Resources\V1\Identity\RoleResource;
use App\Models\Permission;
use App\Models\Role;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Roles and their permissions. Route group requires `roles.manage`.
 * Permissions themselves are defined in code (App\Domain\Identity\Permissions)
 * and are read-only through the API.
 */
class RoleController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        return RoleResource::collection(Role::with('permissions')->withCount('users')->orderBy('display_name')->get());
    }

    public function store(SaveRoleRequest $request, SaveRole $save): RoleResource
    {
        $role = $save->create($request->user(), $request->safe()->except('permissions'), $request->input('permissions'));

        return new RoleResource($role->load('permissions')->loadCount('users'));
    }

    public function show(Role $role): RoleResource
    {
        return new RoleResource($role->load('permissions')->loadCount('users'));
    }

    public function update(SaveRoleRequest $request, Role $role, SaveRole $save): RoleResource
    {
        return new RoleResource($save->update($role, $request->validated())->load('permissions')->loadCount('users'));
    }

    public function permissions(SyncRolePermissionsRequest $request, Role $role, SaveRole $save): RoleResource
    {
        $save->syncPermissions($request->user(), $role, $request->input('permissions'));

        return new RoleResource($role->load('permissions')->loadCount('users'));
    }

    public function destroy(Role $role, SaveRole $save): Response
    {
        $save->delete($role);

        return response()->noContent();
    }

    public function permissionCatalog(Request $request): AnonymousResourceCollection
    {
        return PermissionResource::collection(Permission::orderBy('group')->orderBy('name')->get());
    }
}
