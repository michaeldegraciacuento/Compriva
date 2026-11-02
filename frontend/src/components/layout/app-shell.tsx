"use client";

import { Menu, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Brand } from "@/components/brand";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/modules/auth/hooks";
import { SyncIndicator } from "@/modules/offline/components/sync-indicator";

import { Breadcrumbs } from "./breadcrumbs";
import { useKeyboardShortcuts } from "./keyboard-shortcuts";
import { Notifications } from "./notifications";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

/**
 * Signed-in layout: fixed sidebar (≥ lg) or drawer (< lg), header with
 * breadcrumbs, notifications and user menu, and the main content area.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useKeyboardShortcuts(session); // F4: Point of Sale

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" />}>
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex h-16 items-center border-b px-5">
                <Brand />
              </div>
              <div className="overflow-y-auto">
                <SidebarNav onNavigate={() => setDrawerOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>

          <div className="flex items-center gap-1.5">
            {session?.mode === "offline" && (
              <StatusBadge tone="warning" icon={WifiOff}>PIN sign-in</StatusBadge>
            )}
            <SyncIndicator />
            <Notifications />
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
