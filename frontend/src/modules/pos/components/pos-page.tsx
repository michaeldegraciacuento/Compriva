"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";
import { useAuthStore } from "@/modules/auth/store";
import { getPosBackend } from "@/modules/offline/runtime";

import type { PosBackend } from "../backend";
import { PosBackendContext } from "../backend-context";
import { DesktopSetup } from "./desktop-setup";
import { Register } from "./register";
import { OpenShift, RegisterTerminal, TerminalBusy } from "./terminal-setup";

/**
 * Point of sale. The web app sells online through the API; a desktop terminal
 * sells from its local database (online or offline) once it has been set up.
 * Selling then needs the signed-in cashier's open shift on the terminal.
 */
export function PosPage() {
  const backend = useApiQuery(["pos-backend"], getPosBackend);

  if (backend.error) return <Alert variant="destructive"><AlertDescription>{backend.error.message}</AlertDescription></Alert>;
  if (!backend.data) return <Loading />;
  if (backend.data.needsSetup) return <DesktopSetup onDone={backend.reload} />;

  return (
    <PosBackendContext.Provider value={backend.data.backend}>
      <PosScreens backend={backend.data.backend} />
    </PosBackendContext.Provider>
  );
}

function Loading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]" aria-busy="true">
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
    </div>
  );
}

function PosScreens({ backend }: { backend: PosBackend }) {
  const bootstrap = useApiQuery(["pos-bootstrap", backend.kind], () => backend.bootstrap());
  const userId = useAuthStore((s) => s.session?.user.id);
  const canManageShifts = useCan("cashier.manage_shifts");

  if (bootstrap.error) {
    return <Alert variant="destructive"><AlertDescription>{bootstrap.error.message}</AlertDescription></Alert>;
  }
  if (!bootstrap.data) return <Loading />;

  const data = bootstrap.data;
  if (!data.terminal) return <RegisterTerminal bootstrap={data} onDone={bootstrap.reload} />;
  if (data.terminal.status !== "active") {
    return <Alert variant="destructive"><AlertDescription>Terminal {data.terminal.code} has been revoked and cannot sell.</AlertDescription></Alert>;
  }
  if (!data.shift) return <OpenShift bootstrap={data} onDone={bootstrap.reload} />;
  if (data.shift.cashier.id !== userId) return <TerminalBusy shift={data.shift} canManage={canManageShifts} onDone={bootstrap.reload} />;

  return <Register bootstrap={data} shift={data.shift} onShiftClosed={bootstrap.reload} />;
}
