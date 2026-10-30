"use client";

import { ShieldCheck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { usePos } from "../backend-context";
import type { Approval } from "../types";

const PERMISSION_LABELS: Record<string, string> = {
  "pos.apply_discount": "discounts",
  "pos.price_override": "price changes",
  "sales.void": "voids",
  "sales.return": "returns",
  "cashier.cash_movements": "cash in/out",
};

/**
 * Manager override on the cashier's screen: a user allowed to approve types
 * their username and PIN (or password). Online the server checks it; desktop
 * terminals check the PIN against cached bcrypt hashes, also offline.
 */
export function ApprovalFields({ permissions, value, onChange, idPrefix, pinOnly }: {
  permissions: string[];
  value: Approval;
  onChange: (approval: Approval) => void;
  idPrefix: string;
  /** Desktop terminals check approvals against cached PIN hashes (they also work offline). */
  pinOnly?: boolean;
}) {
  const localPos = usePos().kind === "local";
  const pin = pinOnly ?? localPos;
  const what = permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(" and ");

  return (
    <fieldset className="grid gap-3 rounded-lg border border-warning/40 bg-warning-soft/50 p-3">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        <ShieldCheck className="size-4 text-warning" aria-hidden /> Manager approval for {what}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-login`}>Manager username</Label>
          <Input id={`${idPrefix}-login`} autoComplete="off" value={value.login} onChange={(e) => onChange({ ...value, login: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-secret`}>{pin ? "Manager PIN" : "PIN or password"}</Label>
          <Input id={`${idPrefix}-secret`} type="password" autoComplete="off" value={value.secret} onChange={(e) => onChange({ ...value, secret: e.target.value })} />
        </div>
      </div>
    </fieldset>
  );
}

export const emptyApproval = (): Approval => ({ login: "", secret: "" });
export const hasApproval = (approval: Approval) => approval.login.trim() !== "" && approval.secret !== "";
