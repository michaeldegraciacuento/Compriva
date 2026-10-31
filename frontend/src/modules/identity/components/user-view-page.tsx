"use client";

import { Ban, LogOut, UserCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toApiError } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { AuditTrail } from "@/modules/system/components/audit-trail";

import { activateUser, fetchRoleOptions, fetchUser, resetCredentials, revokeAccess, setUserRoles, suspendUser, updateUser } from "../api";
import type { ManagedUser, RoleOption } from "../types";
import { RoleChecklist } from "./role-checklist";

/** One user: details, roles, password and PIN, suspension. Every change is audited on the server. */
export function UserViewPage() {
  const id = useSearchParams().get("id") ?? "";
  const found = useApiQuery(["user", id], () => fetchUser(id));
  const roles = useApiQuery(["role-options"], fetchRoleOptions);
  const [message, setMessage] = useState<string | null>(null);

  if (found.error) return <Alert variant="destructive"><AlertDescription>{found.error.message}</AlertDescription></Alert>;
  if (!found.data) return <Skeleton className="h-96" aria-busy="true" />;
  const { user, meta } = found.data;
  const locked = !meta.manageable;

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      await found.reload();
      setMessage(null);
      notify.success(done);
    } catch (caught) {
      throw new Error(toApiError(caught).message);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title={user.name}
        description={[user.username, user.email, user.last_login_at ? `last signed in ${formatDate(user.last_login_at)} ${formatTime(user.last_login_at)}` : "never signed in"].filter(Boolean).join(" · ")}
        actions={!locked && (
          <>
            <ConfirmDialog
              trigger={<Button variant="outline"><LogOut aria-hidden /> Sign out everywhere</Button>}
              title={`Sign ${user.name} out everywhere?`}
              description="Every browser session and terminal they are signed in on is signed out. They can sign in again."
              confirmLabel="Sign out"
              onConfirm={() => run(() => revokeAccess(user.id), `${user.name} was signed out everywhere.`)}
            />
            {!meta.is_self && (user.is_active ? (
              <ConfirmDialog
                trigger={<Button variant="destructive"><Ban aria-hidden /> Suspend</Button>}
                title={`Suspend ${user.name}?`}
                description="They are signed out everywhere and cannot sign in, online or offline, until activated again. Their sales and history are kept."
                confirmLabel="Suspend"
                destructive
                onConfirm={() => run(() => suspendUser(user.id), `${user.name} is suspended.`)}
              />
            ) : (
              <Button onClick={() => void run(() => activateUser(user.id), `${user.name} can sign in again.`).catch((e: Error) => setMessage(e.message))}>
                <UserCheck aria-hidden /> Activate
              </Button>
            ))}
          </>
        )}
      />

      <div className="flex flex-wrap gap-1">
        {user.is_active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="danger">Suspended</StatusBadge>}
        {user.roles.map((r) => <StatusBadge key={r.id} tone="neutral">{r.display_name}</StatusBadge>)}
        {meta.is_self && <StatusBadge tone="info">You</StatusBadge>}
      </div>
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
      {locked && (
        <Alert><AlertDescription>{user.name} has more access than you, so only someone with at least the same access (an owner) can change this account.</AlertDescription></Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <DetailsPanel key={user.updated_at} user={user} disabled={locked} onSaved={() => run(() => Promise.resolve(), "Details saved.")} />
        {roles.data && <RolesPanel key={user.roles.map((r) => r.id).join()} user={user} options={roles.data} disabled={locked} isSelf={meta.is_self} onSaved={() => run(() => Promise.resolve(), "Roles saved. Terminals pick up the change with their next sync.")} />}
        <CredentialsPanel user={user} disabled={locked} onDone={(text) => notify.success(text)} />
        <AuditTrail type="user" id={user.id} version={user.updated_at} />
      </div>
    </div>
  );
}

function SaveRow({ error, busy, disabled, label }: { error: string | null; busy: boolean; disabled?: boolean; label: string }) {
  return (
    <>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex justify-end"><Button type="submit" disabled={busy || disabled}>{busy ? "Saving…" : label}</Button></div>
    </>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit };
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function DetailsPanel({ user, disabled, onSaved }: { user: ManagedUser; disabled: boolean; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: user.name, username: user.username, email: user.email ?? "" });
  const { busy, error, submit } = useSubmit(async () => {
    await updateUser(user.id, { name: form.name.trim(), username: form.username.trim(), email: form.email.trim() || null });
    await onSaved();
  });
  const changed = form.name !== user.name || form.username !== user.username || form.email !== (user.email ?? "");

  return (
    <Panel title="Details">
      <form className="grid gap-3" onSubmit={submit}>
        <fieldset className="grid gap-3" disabled={disabled}>
          <Field id="user-name" label="Full name"><Input id="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={255} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="user-username" label="Username"><Input id="user-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={3} maxLength={50} autoComplete="off" /></Field>
            <Field id="user-email" label="Email"><Input id="user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={255} /></Field>
          </div>
        </fieldset>
        <SaveRow error={error} busy={busy} disabled={disabled || !changed} label="Save details" />
      </form>
    </Panel>
  );
}

function RolesPanel({ user, options, disabled, isSelf, onSaved }: { user: ManagedUser; options: RoleOption[]; disabled: boolean; isSelf: boolean; onSaved: () => Promise<void> }) {
  const initial = user.roles.map((r) => r.id);
  const [selected, setSelected] = useState(initial);
  const { busy, error, submit } = useSubmit(async () => {
    await setUserRoles(user.id, selected);
    await onSaved();
  });
  const changed = selected.length !== initial.length || selected.some((id) => !initial.includes(id));

  return (
    <Panel title="Roles" description={isSelf ? "Careful: removing your own roles takes access away from you at once." : "What this person may do. Change what a role allows on the Roles page."}>
      <form className="grid gap-3" onSubmit={submit}>
        <RoleChecklist options={options} value={selected} onChange={setSelected} disabled={disabled} />
        {selected.length === 0 && <p className="text-sm text-warning">Without a role they can sign in but do nothing.</p>}
        <SaveRow error={error} busy={busy} disabled={disabled || !changed} label="Save roles" />
      </form>
    </Panel>
  );
}

function CredentialsPanel({ user, disabled, onDone }: { user: ManagedUser; disabled: boolean; onDone: (message: string) => void }) {
  const [password, setPassword] = useState({ password: "", password_confirmation: "" });
  const [pin, setPin] = useState("");
  const pw = useSubmit(async () => {
    if (password.password !== password.password_confirmation) throw new Error("The passwords do not match.");
    await resetCredentials(user.id, password);
    setPassword({ password: "", password_confirmation: "" });
    onDone(`New password set. ${user.name} was signed out everywhere and must use it from now on.`);
  });
  const pinForm = useSubmit(async () => {
    if (!/^\d{6}$/.test(pin)) throw new Error("The PIN must be exactly 6 digits.");
    await resetCredentials(user.id, { pin });
    setPin("");
    onDone(`New PIN set for ${user.name}. Terminals receive it with their next sync.`);
  });
  const removePin = async () => {
    await resetCredentials(user.id, { pin: null }).catch((caught) => { throw new Error(toApiError(caught).message); });
    onDone(`${user.name}'s PIN was removed. They can no longer sign in to terminals with a PIN.`);
  };

  return (
    <Panel title="Password and PIN" description="For a forgotten password or PIN. The person can change both later from their own profile.">
      <div className="grid gap-6">
        <form className="grid gap-3" onSubmit={pw.submit}>
          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={disabled}>
            <Field id="reset-password" label="New password"><Input id="reset-password" type="password" autoComplete="new-password" minLength={8} required value={password.password} onChange={(e) => setPassword({ ...password, password: e.target.value })} /></Field>
            <Field id="reset-password-confirm" label="Confirm password"><Input id="reset-password-confirm" type="password" autoComplete="new-password" required value={password.password_confirmation} onChange={(e) => setPassword({ ...password, password_confirmation: e.target.value })} /></Field>
          </fieldset>
          <SaveRow error={pw.error} busy={pw.busy} disabled={disabled} label="Set password" />
        </form>

        <form className="grid gap-3" onSubmit={pinForm.submit}>
          <fieldset disabled={disabled}>
            <Field id="reset-pin" label={user.has_pin ? "New PIN (6 digits)" : "PIN (6 digits), for terminals and offline sign-in"}>
              <Input id="reset-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" required value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
          </fieldset>
          {pinForm.error && <Alert variant="destructive"><AlertDescription>{pinForm.error}</AlertDescription></Alert>}
          <div className="flex justify-end gap-2">
            {user.has_pin && !disabled && (
              <ConfirmDialog
                trigger={<Button type="button" variant="ghost">Remove PIN</Button>}
                title="Remove the PIN?"
                description="They will not be able to sign in to terminals with a PIN or approve with one."
                confirmLabel="Remove PIN"
                destructive
                onConfirm={removePin}
              />
            )}
            <Button type="submit" disabled={pinForm.busy || disabled}>{pinForm.busy ? "Saving…" : user.has_pin ? "Change PIN" : "Set PIN"}</Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}
