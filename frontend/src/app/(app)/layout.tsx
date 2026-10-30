import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/modules/auth/components/auth-guard";

/**
 * Every route in this group requires a signed-in user.
 *
 * Pages render only after the client knows who the user is (AuthGuard), so
 * `next dev` reports an "instant navigation" insight for this segment. That
 * insight is dev-only. Opting out with `export const instant = false` is not
 * possible: it requires cacheComponents, which the desktop static export disables.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
