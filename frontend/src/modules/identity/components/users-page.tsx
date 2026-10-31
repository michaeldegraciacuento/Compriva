"use client";

import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";

import { createUser, fetchRoleOptions, fetchUsers, type NewUserInput, type UserFilters } from "../api";
import type { RoleOption } from "../types";
import { RoleChecklist } from "./role-checklist";

/** Everyone who can sign in: their roles, status and last sign-in. */
export function UsersPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<UserFilters>({ page: 1 });
  const [adding, setAdding] = useState(false);
  const users = useApiQuery(["users", filters], () => fetchUsers(filters));
  const roles = useApiQuery(["role-options"], fetchRoleOptions);
  const update = (patch: UserFilters) => setFilters({ ...filters, ...patch, page: 1 });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Users"
        description="Staff accounts: what each person may do comes from their roles."
        actions={<Button onClick={() => setAdding(true)} disabled={!roles.data}><Plus aria-hidden /> Add user</Button>}
      />

      <Panel title="Users" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:flex-wrap">
          <SearchInput label="Search users" placeholder="Name, username or email" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Role" value={filters.role ?? ""} onChange={(e) => update({ role: e.target.value || undefined })} className="sm:w-48">
            <option value="">All roles</option>
            {roles.data?.map((r) => <option key={r.id} value={r.name}>{r.display_name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Status" value={filters.status ?? ""} onChange={(e) => update({ status: (e.target.value || undefined) as UserFilters["status"] })} className="sm:w-40">
            <option value="">Active and suspended</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </NativeSelect>
        </div>
        {users.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{users.error.message}</AlertDescription></Alert>
        ) : users.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : users.data?.data.length === 0 ? (
          <EmptyState icon={Users} title="No users found" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="hidden md:table-cell">PIN</TableHead>
                <TableHead className="hidden pr-5 lg:table-cell">Last sign-in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.data.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => router.push(`/users/view?id=${u.id}`)}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <Link href={`/users/view?id=${u.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{u.name}</Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.username}{u.email && ` · ${u.email}`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {u.roles.map((r) => <StatusBadge key={r.id} tone="neutral">{r.display_name}</StatusBadge>)}
                      {!u.is_active && <StatusBadge tone="danger">Suspended</StatusBadge>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.has_pin ? "Set" : <span className="text-muted-foreground">None</span>}</TableCell>
                  <TableCell className="hidden pr-5 lg:table-cell">{u.last_login_at ? formatDate(u.last_login_at) : <span className="text-muted-foreground">Never</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={users.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>

      {adding && roles.data && <NewUserDialog roles={roles.data} onClose={() => setAdding(false)} onCreated={(id) => router.push(`/users/view?id=${id}`)} />}
    </div>
  );
}

function NewUserDialog({ roles, onClose, onCreated }: { roles: RoleOption[]; onClose: () => void; onCreated: (id: string) => void }) {
  const cashier = roles.find((r) => r.name === "cashier" && r.grantable);
  const [form, setForm] = useState<NewUserInput>({ name: "", username: "", email: null, password: "", password_confirmation: "", pin: null, roles: cashier ? [cashier.id] : [] });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<NewUserInput>) => setForm({ ...form, ...patch });

  const problem =
    form.password !== form.password_confirmation ? "The passwords do not match."
      : form.pin && !/^\d{6}$/.test(form.pin) ? "The PIN must be exactly 6 digits."
        : form.roles.length === 0 ? "Choose at least one role." : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const user = await createUser({ ...form, email: form.email?.trim() || null, pin: form.pin || null });
      notify.success("User created", `${user.name} can now sign in as ${user.username}.`);
      onCreated(user.id);
    } catch (caught) {
      const apiError = toApiError(caught);
      const fields = (apiError.details.fields ?? {}) as Record<string, string[]>;
      setFieldErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]])));
      setError(apiError.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "name" | "username" | "email" | "password" | "password_confirmation" | "pin", label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`new-user-${key}`}>{label}</Label>
      <Input id={`new-user-${key}`} value={form[key] ?? ""} onChange={(e) => set({ [key]: e.target.value })} aria-invalid={fieldErrors[key] ? true : undefined} {...props} />
      {fieldErrors[key] && <p className="text-xs text-danger">{fieldErrors[key]}</p>}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>They sign in with the username and password. Cashiers also need a 6-digit PIN for terminals and offline sign-in.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          {field("name", "Full name", { required: true, maxLength: 255, autoFocus: true })}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("username", "Username", { required: true, minLength: 3, maxLength: 50, autoComplete: "off", pattern: "[A-Za-z0-9_\\-]+", title: "Letters, numbers, dashes and underscores" })}
            {field("email", "Email (optional)", { type: "email", maxLength: 255 })}
            {field("password", "Password", { type: "password", required: true, autoComplete: "new-password", minLength: 8 })}
            {field("password_confirmation", "Confirm password", { type: "password", required: true, autoComplete: "new-password" })}
            {field("pin", "PIN (optional)", { type: "password", inputMode: "numeric", maxLength: 6, autoComplete: "off" })}
          </div>
          <p className="text-xs text-muted-foreground">Passwords need at least 8 characters with letters and numbers.</p>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Roles</legend>
            <RoleChecklist options={roles} value={form.roles} onChange={(ids) => set({ roles: ids })} />
          </fieldset>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
