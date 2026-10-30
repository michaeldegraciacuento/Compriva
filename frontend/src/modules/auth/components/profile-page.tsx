"use client";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { useSession } from "../hooks";
import { ChangePasswordForm, ChangePinForm } from "./credential-forms";

function groupPermissions(permissions: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const permission of permissions) {
    const [group, action] = permission.split(".");
    groups.set(group, [...(groups.get(group) ?? []), action]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function ProfilePage() {
  const session = useSession();
  if (!session) return null;

  const offline = session.mode === "offline";

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title="My profile" description="Your account, roles and sign-in credentials." />

      {offline && (
        <Alert>
          <AlertDescription>
            You signed in offline with your PIN. Profile changes need a connection to the Compriva server.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{session.user.name}</CardTitle>
          <CardDescription>
            @{session.user.username}
            {session.user.email ? ` · ${session.user.email}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2" data-testid="profile-roles">
            <span className="text-muted-foreground">Roles</span>
            {session.roles.map((role) => (
              <Badge key={role} variant="secondary">{role}</Badge>
            ))}
          </div>
          <div className="text-muted-foreground">
            Signed in {session.method === "session" ? "with a web session" : session.method === "token" ? "at a terminal" : "offline with PIN"}
            {session.device ? ` · terminal ${session.device.code}` : ""}
          </div>
          <details>
            <summary className="cursor-pointer">Permissions ({session.permissions.length})</summary>
            <dl className="mt-2 grid gap-1">
              {groupPermissions(session.permissions).map(([group, actions]) => (
                <div key={group} className="flex gap-2">
                  <dt className="w-28 shrink-0 font-medium capitalize">{group}</dt>
                  <dd className="text-muted-foreground">{actions.join(", ")}</dd>
                </div>
              ))}
            </dl>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Changing your password signs you out of all other sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm disabled={offline} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terminal PIN</CardTitle>
          <CardDescription>Used to sign in at checkout terminals, also when they are offline.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePinForm disabled={offline} />
        </CardContent>
      </Card>
    </div>
  );
}
