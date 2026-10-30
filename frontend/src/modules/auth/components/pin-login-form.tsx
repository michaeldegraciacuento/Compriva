"use client";

import { useState, type FormEvent } from "react";

import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { OfflineAuthError } from "../offline";
import { useAuthStore } from "../store";

/**
 * Desktop terminals without internet: username + PIN, checked against the
 * cashier list the terminal downloaded at its last sync (bcrypt hashes,
 * verified in native code). Wrong PINs lock the username for a while.
 */
export function PinLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const loginWithPin = useAuthStore((state) => state.loginWithPin);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await loginWithPin(username, pin);
      onSuccess();
    } catch (error) {
      setMessage(error instanceof OfflineAuthError || error instanceof Error ? error.message : "Sign-in failed.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <p className="text-sm text-muted-foreground">Works without internet, with the cashier list this terminal downloaded at its last sync.</p>
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <FormField id="pin-username" label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
      <FormField id="pin" label="PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
      <Button type="submit" size="lg" disabled={busy || username.trim() === "" || pin === ""}>
        {busy ? "Checking…" : "Sign in with PIN"}
      </Button>
    </form>
  );
}
