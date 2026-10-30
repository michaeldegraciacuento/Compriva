"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useSession } from "@/modules/auth/hooks";

import { navigationFor } from "./navigation";

/** Grouped, permission-filtered navigation. Used by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = navigationFor(useSession());

  return (
    <nav aria-label="Main" className="grid gap-5 px-3 py-4">
      {groups.map((group, index) => (
        <div key={group.label ?? index} className="grid gap-0.5">
          {group.label && (
            <p className="px-3 pb-1 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</p>
          )}
          {group.items.map(({ label, href, icon: Icon, available }) => {
            const active = pathname === href;
            const base = "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm";

            return available ? (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                data-testid={`nav-${label}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  base,
                  "text-sidebar-foreground transition-colors hover:bg-muted",
                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className={cn("size-4 text-muted-foreground", active && "text-primary")} aria-hidden />
                {label}
              </Link>
            ) : (
              <span key={href} data-testid={`nav-${label}`} aria-disabled="true" title="Available in a later release"
                className={cn(base, "cursor-default text-muted-foreground")}>
                <Icon className="size-4 opacity-70" aria-hidden />
                {label}
                <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium">Soon</span>
              </span>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
