"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuthStore } from "../store";

/**
 * Protects every route inside app/(app). Unauthenticated users are sent to
 * /login?next=<current path>. This is a UX guard only: the API rejects
 * unauthenticated and unauthorized requests on its own.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    if (status === "loading") void bootstrap();
    if (status === "guest") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, bootstrap, router, pathname]);

  if (status !== "authenticated") {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground" role="status">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}

/** Renders children only for users holding the permission (UI convenience; the API re-checks). */
export function RequirePermission({ permission, children, fallback = null }: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useAuthStore((state) => state.session?.permissions.includes(permission) ?? false);
  return <>{allowed ? children : fallback}</>;
}
