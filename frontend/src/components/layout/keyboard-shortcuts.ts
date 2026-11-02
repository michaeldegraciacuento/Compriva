"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { can } from "@/modules/auth/permissions";
import type { Session } from "@/modules/auth/types";

/** App-wide keys. F4 is the till key on most POS keyboards. */
export const SHORTCUTS = {
  pos: { key: "F4", label: "F4", href: "/pos", permission: "pos.access" },
} as const;

type KeyLike = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

/**
 * What a key press should do: "open" the POS, "focus" its scan box when the
 * POS is already showing, or null. Plain F4 only: Alt+F4 still closes the
 * window, and people without POS access get nothing.
 */
export function posShortcut(event: KeyLike, session: Session | null, pathname: string): "open" | "focus" | null {
  if (event.key !== SHORTCUTS.pos.key || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (!can(session, SHORTCUTS.pos.permission)) return null;
  return pathname === SHORTCUTS.pos.href ? "focus" : "open";
}

/** Listens for the app-wide shortcuts while signed in (mounted by AppShell). */
export function useKeyboardShortcuts(session: Session | null) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = posShortcut(event, session, pathname);
      if (!action) return;
      event.preventDefault(); // some browsers use F4 for the address bar
      if (action === "open") router.push(SHORTCUTS.pos.href);
      else document.getElementById("pos-scan")?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, pathname, router]);
}
