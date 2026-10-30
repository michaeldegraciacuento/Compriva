"use client";

import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/page-header";
import { navigationFor } from "@/components/layout/navigation";
import { useCan, useSession } from "@/modules/auth/hooks";
import { DashboardPage } from "@/modules/dashboard/components/dashboard-page";

/** Home: the dashboard for people allowed to see it, a short welcome for everyone else. */
export function HomePage() {
  const canSeeDashboard = useCan("dashboard.view");
  return canSeeDashboard ? <DashboardPage /> : <WelcomePage />;
}

function WelcomePage() {
  const session = useSession();
  const modules = navigationFor(session).flatMap((group) => group.items).filter((item) => item.href !== "/");

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={`Welcome, ${session?.user.name ?? ""}`} description="Here is what your role can use in Compriva." />
      <Panel title="Your modules" description="Modules marked “Soon” arrive in later releases.">
        {modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your role has no modules yet. Ask your manager for access.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(({ label, icon: Icon, available, href }) => (
              <li key={href} className="flex items-center gap-3 rounded-lg border p-3">
                <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground" aria-hidden>
                  <Icon className="size-4" />
                </span>
                <span className="font-medium">{label}</span>
                {!available && <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Soon</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
