"use client";

import { Lock, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { useSession } from "@/modules/auth/hooks";

import { createRole, deleteRole, fetchPermissions, fetchRoles, setRolePermissions, updateRole } from "../api";
import { PERMISSION_GROUPS, SENSITIVE_PERMISSIONS, type Permission, type Role } from "../types";

/** "Shift supervisor" → "shift_supervisor": the role's fixed internal name. */
export const roleKey = (displayName: string) =>
  displayName.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 50);

/** Creates a role (optionally starting from another) or edits one's name and permissions. */
export function RoleEditPage() {
  const id = useSearchParams().get("id");
  const roles = useApiQuery(["roles"], fetchRoles);
  const permissions = useApiQuery(["permissions"], fetchPermissions);

  const error = roles.error ?? permissions.error;
  if (error) return <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>;
  if (!roles.data || !permissions.data) return <Skeleton className="h-96" aria-busy="true" />;
  const role = id ? roles.data.find((r) => r.id === id) : null;
  if (id && !role) return <Alert variant="destructive"><AlertDescription>This role no longer exists.</AlertDescription></Alert>;

  return <RoleForm key={role?.id ?? "new"} role={role ?? null} roles={roles.data} permissions={permissions.data} onSaved={roles.reload} />;
}

function RoleForm({ role, roles, permissions, onSaved }: { role: Role | null; roles: Role[]; permissions: Permission[]; onSaved: () => Promise<void> }) {
  const router = useRouter();
  const session = useSession();
  const mine = new Set(session?.permissions ?? []);
  const isOwner = role?.name === "owner";
  const [displayName, setDisplayName] = useState(role?.display_name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Changing a permission you do not hold yourself is refused by the server: those boxes are locked.
  const canChange = (name: string) => !isOwner && mine.has(name);
  const toggle = (name: string, on: boolean) => setSelected(on ? [...selected, name] : selected.filter((p) => p !== name));
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, items: permissions.filter((p) => p.group === g.group) }))
    .concat([{ group: "other", label: "Other", items: permissions.filter((p) => !PERMISSION_GROUPS.some((g) => g.group === p.group)) }])
    .filter((g) => g.items.length > 0);

  const key = roleKey(displayName);
  const permissionsChanged = role === null || selected.length !== role.permissions.length || selected.some((p) => !role.permissions.includes(p));
  const detailsChanged = role === null || displayName.trim() !== role.display_name || (description.trim() || null) !== role.description;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (role === null) {
        if (!key) throw new Error("Enter a role name that starts with a letter.");
        const created = await createRole({ name: key, display_name: displayName.trim(), description: description.trim() || null, permissions: selected });
        await onSaved();
        notify.success("Role created", created.display_name);
        router.replace(`/roles/edit?id=${created.id}`);
        return;
      }
      if (detailsChanged) await updateRole(role.id, { display_name: displayName.trim(), description: description.trim() || null });
      if (permissionsChanged && !isOwner) await setRolePermissions(role.id, selected);
      await onSaved();
      notify.success(`${displayName.trim()} saved`, `People with this role (${role.users_count}) get the new permissions on their next request; terminals with their next sync.`);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <PageHeader
        title={role ? role.display_name : "New role"}
        description={role ? `${role.users_count} ${role.users_count === 1 ? "user" : "users"} · ${selected.length} of ${permissions.length} permissions` : "Name the role and tick what it may do."}
        actions={
          <>
            {role && !role.is_system && (
              <ConfirmDialog
                trigger={<Button type="button" variant="outline" disabled={role.users_count > 0}><Trash2 aria-hidden /> Delete</Button>}
                title={`Delete ${role.display_name}?`}
                description="The role is removed. This cannot be undone."
                confirmLabel="Delete role"
                destructive
                onConfirm={async () => {
                  await deleteRole(role.id).catch((caught) => { throw new Error(toApiError(caught).message); });
                  notify.success("Role deleted", role.display_name);
                  router.push("/roles");
                }}
              />
            )}
            <Button type="submit" disabled={busy || (!detailsChanged && !permissionsChanged) || !displayName.trim()}>{busy ? "Saving…" : role ? "Save role" : "Create role"}</Button>
          </>
        }
      />
      {role && !role.is_system && role.users_count > 0 && <p className="-mt-4 text-sm text-muted-foreground">To delete this role, first take it away from its {role.users_count} users.</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {isOwner && <Alert><AlertDescription>The owner role always has every permission, so the store can never lock itself out.</AlertDescription></Alert>}

      <Panel title="Role">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={100} autoFocus={role === null} placeholder="e.g. Shift supervisor" />
            {role === null && key && <p className="text-xs text-muted-foreground">Internal name: {key}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} placeholder="Who has this role" />
          </div>
          {role === null && (
            <div className="grid gap-1.5">
              <Label htmlFor="role-from">Start from</Label>
              <NativeSelect id="role-from" defaultValue="" onChange={(e) => setSelected((roles.find((r) => r.id === e.target.value)?.permissions ?? []).filter((p) => mine.has(p)))}>
                <option value="">Nothing ticked</option>
                {roles.map((r) => <option key={r.id} value={r.id}>Copy {r.display_name}</option>)}
              </NativeSelect>
            </div>
          )}
        </div>
      </Panel>

      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const changeable = g.items.filter((p) => canChange(p.name));
          const allOn = g.items.every((p) => selected.includes(p.name));
          return (
            <fieldset key={g.group} className="grid gap-2 rounded-xl border bg-card p-4">
              <legend className="sr-only">{g.label}</legend>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold" aria-hidden>{g.label}</h2>
                {changeable.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const names = changeable.map((p) => p.name);
                      setSelected(allOn ? selected.filter((p) => !names.includes(p)) : [...new Set([...selected, ...names])]);
                    }}
                  >
                    {allOn ? "None" : "All"}
                  </Button>
                )}
              </div>
              {g.items.map((p) => {
                const locked = !canChange(p.name);
                return (
                  <label key={p.name} className={cn("flex items-start gap-2.5 rounded-md p-1.5 text-sm", locked ? "opacity-60" : "cursor-pointer hover:bg-muted")}>
                    <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={isOwner || selected.includes(p.name)} disabled={locked} onChange={(e) => toggle(p.name, e.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {p.display_name}
                        {SENSITIVE_PERMISSIONS.has(p.name) && <StatusBadge tone="warning">Sensitive</StatusBadge>}
                        {locked && !isOwner && <Lock className="size-3.5 text-muted-foreground" aria-label="You do not have this permission yourself" />}
                      </span>
                      <span className="block text-xs text-muted-foreground">{p.name}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>
    </form>
  );
}
