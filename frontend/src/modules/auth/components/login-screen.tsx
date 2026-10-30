"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatform } from "@/platform";
import type { PlatformKind } from "@/platform/types";

import { useAuthStore } from "../store";
import { LoginForm } from "./login-form";
import { PinLoginForm } from "./pin-login-form";

/** Only same-app paths: prevents open redirects through ?next=. */
export function safeNextPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
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

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <Brand />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Sign in</CardTitle>
          <CardDescription>
            {kind === "desktop" ? "Sign in to start selling at this checkout." : "Sign in to manage your store."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kind === null || status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : kind === "desktop" && method === "pin" ? (
            <div className="grid gap-4">
              <PinLoginForm onSuccess={() => router.replace(next)} />
              <Button variant="link" className="h-auto p-0" onClick={() => setMethod("password")}>Sign in with your password instead</Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <LoginForm onSuccess={() => router.replace(next)} />
              {kind === "desktop" && (
                <Button variant="link" className="h-auto p-0" onClick={() => setMethod("pin")}>No internet? Sign in with your PIN</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
