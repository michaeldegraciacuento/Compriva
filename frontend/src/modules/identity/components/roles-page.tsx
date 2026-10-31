"use client";

import { Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiQuery } from "@/lib/use-api-query";

import { fetchPermissions, fetchRoles } from "../api";

/** Roles and how much each allows. Permissions themselves are fixed in the app; roles group them. */
export function RolesPage() {
  const router = useRouter();
  const roles = useApiQuery(["roles"], fetchRoles);
  const permissions = useApiQuery(["permissions"], fetchPermissions);
  const total = permissions.data?.length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Roles"
        description="A role is a set of permissions. Give people roles on the Users page."
        actions={<LinkButton href="/roles/edit"><Plus aria-hidden /> New role</LinkButton>}
      />
      <Panel title="Roles" flush>
        {roles.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{roles.error.message}</AlertDescription></Alert>
        ) : roles.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : roles.data?.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No roles" />
        ) : (
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Role</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="pr-5 text-right">Permissions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data?.map((role) => (
                <TableRow key={role.id} className="cursor-pointer" onClick={() => router.push(`/roles/edit?id=${role.id}`)}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/roles/edit?id=${role.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{role.display_name}</Link>
                      {role.is_system && <StatusBadge tone="neutral">Built-in</StatusBadge>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{role.description ?? role.name}</span>
                  </TableCell>
                  <TableCell className="text-right">{role.users_count}</TableCell>
                  <TableCell className="pr-5 text-right">{role.permissions.length}{total ? ` of ${total}` : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
