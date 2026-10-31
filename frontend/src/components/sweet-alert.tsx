"use client";

import { useEffect } from "react";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type AlertKind = "success" | "info" | "warning" | "error";

export interface SweetAlertOptions {
  kind: AlertKind;
  title: string;
  text?: string;
  /** Closes by itself after this many ms. 0 = stays until OK. */
  timer?: number;
}

interface AlertState {
  current: (SweetAlertOptions & { id: number }) | null;
  show: (options: SweetAlertOptions) => void;
  close: () => void;
}

let sequence = 0;

/** The one alert on screen; a new one replaces the previous. */
export const useSweetAlert = create<AlertState>()((set) => ({
  current: null,
  show: (options) => set({ current: { ...options, id: ++sequence } }),
  close: () => set({ current: null }),
}));

const TONE: Record<AlertKind, string> = {
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  error: "text-danger",
};

/** The animated icon: a ring that draws itself, then the mark (✓, i, !, ✕). */
function AlertIcon({ kind }: { kind: AlertKind }) {
  return (
    <svg viewBox="0 0 80 80" className={cn("sweet-icon size-20", TONE[kind])} aria-hidden>
      <circle cx="40" cy="40" r="36" className="sweet-ring-bg" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="40" cy="40" r="36" className="sweet-ring" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      {kind === "success" && <path className="sweet-mark" d="M24 41 l11 11 l21 -23" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === "error" && <path className="sweet-mark" d="M28 28 L52 52 M52 28 L28 52" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />}
      {kind === "warning" && (
        <>
          <path className="sweet-mark" d="M40 22 V45" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
          <circle className="sweet-dot" cx="40" cy="56" r="3.5" fill="currentColor" />
        </>
      )}
      {kind === "info" && (
        <>
          <circle className="sweet-dot" cx="40" cy="25" r="3.5" fill="currentColor" />
          <path className="sweet-mark" d="M40 35 V57" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * Centered confirmation pop-up ("sweet alert") for the result of something the
 * user did: saved, added, deleted, posted. Mounted once in the root layout and
 * opened through `notify` (src/lib/notify.ts). Enter, Escape or OK closes it.
 */
export function SweetAlertHost() {
  const { current, close } = useSweetAlert();
  return current ? <AlertDialog key={current.id} alert={current} onClose={close} /> : null;
}

function AlertDialog({ alert, onClose }: { alert: SweetAlertOptions; onClose: () => void }) {
  const timer = alert.timer ?? 0;

  useEffect(() => {
    if (timer <= 0) return;
    const handle = window.setTimeout(onClose, timer);
    return () => window.clearTimeout(handle);
  }, [timer, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="sweet-popup max-w-[22rem] overflow-hidden p-0 text-center sm:max-w-sm"
        data-kind={alert.kind}
      >
        <div className="grid justify-items-center gap-3 px-6 pt-8 pb-6">
          <AlertIcon kind={alert.kind} />
          <DialogTitle className="text-xl font-semibold text-balance">{alert.title}</DialogTitle>
          {alert.text && <DialogDescription className="text-sm text-balance text-muted-foreground">{alert.text}</DialogDescription>}
          <Button className="mt-2 min-w-28" onClick={onClose} autoFocus variant={alert.kind === "error" ? "destructive" : "default"}>OK</Button>
        </div>
        {timer > 0 && (
          <div className="h-1 w-full bg-muted" aria-hidden>
            <div
              className={cn("sweet-timer h-full", TONE[alert.kind].replace("text-", "bg-"))}
              style={{ animationDuration: `${timer}ms` }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
