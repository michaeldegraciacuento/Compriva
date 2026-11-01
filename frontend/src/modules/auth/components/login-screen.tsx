"use client";

import { Printer, ScanBarcode, ShoppingBasket, WifiOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getPlatform } from "@/platform";
import type { PlatformKind } from "@/platform/types";

import { useAuthStore } from "../store";
import { LoginForm } from "./login-form";
import { PinLoginForm } from "./pin-login-form";

/** Only same-app paths: prevents open redirects through ?next=. */
export function safeNextPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

const FEATURES = [
  { icon: WifiOff, title: "Keeps selling offline", text: "Checkout terminals save every sale and sync when the internet is back." },
  { icon: ScanBarcode, title: "Scan, print, open the drawer", text: "USB scanners, 58/80 mm thermal printers and cash drawers." },
  { icon: Printer, title: "Stock, reports and audit", text: "Purchasing, expiry alerts, sales reports and a full audit log." },
];

/** A thermal receipt, drawn in CSS: the thing every sale ends with. */
function ReceiptArt() {
  const lines: [string, string][] = [
    ["Pancit Canton ×3", "48.00"],
    ["Century Tuna 155g", "55.50"],
    ["Fresh Eggs ×6", "54.00"],
  ];
  return (
    <div aria-hidden className="login-receipt relative w-60 rotate-[-4deg] bg-white px-5 pt-5 pb-7 font-mono text-[11px] leading-relaxed text-neutral-700 shadow-2xl">
      <p className="text-center text-xs font-bold tracking-wide text-neutral-900">COMPRIVA GROCERY</p>
      <p className="text-center text-[10px] text-neutral-500">T01-000123 · Lane 1</p>
      <div className="my-2 border-t border-dashed border-neutral-300" />
      {lines.map(([item, price]) => (
        <p key={item} className="flex justify-between gap-2"><span className="truncate">{item}</span><span>{price}</span></p>
      ))}
      <div className="my-2 border-t border-dashed border-neutral-300" />
      <p className="flex justify-between text-sm font-bold text-neutral-900"><span>TOTAL</span><span>₱157.50</span></p>
      <p className="flex justify-between"><span>GCash</span><span>157.50</span></p>
      <p className="mt-2 text-center text-[10px] text-neutral-500">Thank you for shopping!</p>
      <div className="mt-2 flex h-7 items-stretch justify-center gap-[2px]">
        {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 1, 3, 2, 1, 2].map((w, i) => (
          <span key={i} className="bg-neutral-800" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

/** Left half: what Compriva is, in the store's own terms. */
function BrandPanel() {
  return (
    <aside className="login-panel relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-lg bg-white/15 ring-1 ring-white/25" aria-hidden>
          <ShoppingBasket className="size-5" strokeWidth={2.25} />
        </span>
        <span className="grid leading-tight">
          <span className="font-semibold tracking-tight">Compriva</span>
          <span className="text-xs text-white/70">Grocery POS &amp; Retail</span>
        </span>
      </div>

      <div className="grid gap-10 xl:grid-cols-[1fr_auto] xl:items-center">
        <div className="grid max-w-md gap-4">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight text-balance xl:text-[2.75rem]">
            Simplify retail. Control everything.
          </h2>
          <p className="text-base text-white/80">
            One system for the counter and the back office: fast checkout, accurate stock and clear reports for your grocery.
          </p>
        </div>
        <div className="hidden justify-center xl:flex"><ReceiptArt /></div>
      </div>

      <ul className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="grid content-start gap-1.5">
            <Icon className="size-5 text-white/90" aria-hidden />
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-white/70">{text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Username or email + password, on the web and on the desktop app; desktop terminals also take a PIN offline. */
export function LoginScreen() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const { status, bootstrap } = useAuthStore();
  const [kind, setKind] = useState<PlatformKind | null>(null);
  const [method, setMethod] = useState<"password" | "pin">("password");

  useEffect(() => {
    void getPlatform().then((platform) => setKind(platform.kind));
    if (status === "loading") void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  const pin = kind === "desktop" && method === "pin";

  return (
    <main className="grid min-h-svh flex-1 bg-background lg:grid-cols-2">
      <BrandPanel />

      <section className="flex flex-col">
        {/* Phones and small windows: a slim brand band instead of the panel. */}
        <div className="login-panel px-6 py-5 text-white lg:hidden">
          <p className="text-sm font-semibold">Compriva</p>
          <p className="text-xs text-white/75">Simplify retail. Control everything.</p>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="grid w-full max-w-sm gap-8">
            <Brand className="hidden lg:flex" />
            <div className="grid gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{pin ? "Sign in with your PIN" : "Sign in"}</h1>
              <p className="text-sm text-muted-foreground">
                {kind === "desktop" ? "Sign in to start selling at this checkout." : "Welcome back. Sign in to manage your store."}
              </p>
            </div>

            {kind === null || status === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : pin ? (
              <div className="grid gap-4">
                <PinLoginForm onSuccess={() => router.replace(next)} />
                <Button variant="link" className="h-auto justify-self-start p-0" onClick={() => setMethod("password")}>Sign in with your password instead</Button>
              </div>
            ) : (
              <div className="grid gap-4">
                <LoginForm onSuccess={() => router.replace(next)} />
                {kind === "desktop" && (
                  <Button variant="link" className="h-auto justify-self-start p-0" onClick={() => setMethod("pin")}>No internet? Sign in with your PIN</Button>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Forgot your password or PIN? Ask the store owner or manager to reset it under Users.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
