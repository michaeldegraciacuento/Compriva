"use client";

import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

import type { RoleOption } from "../types";

/**
 * Roles to give a user. Roles with permissions you do not have are shown but
 * cannot be ticked (the server refuses them too).
 */
export function RoleChecklist({ options, value, onChange, disabled = false }: {
  options: RoleOption[];
  value: string[];
  onChange: (roles: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="grid gap-2" aria-label="Roles">
      {options.map((role) => {
        const checked = value.includes(role.id);
        const locked = !role.grantable && !checked;
        return (
          <li key={role.id}>
            <label className={cn("flex items-start gap-3 rounded-lg border p-3", checked && "border-primary bg-primary/5", (locked || disabled) ? "opacity-60" : "cursor-pointer hover:bg-muted")}>
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={checked}
                disabled={disabled || locked || (!role.grantable && checked)}
                onChange={(e) => onChange(e.target.checked ? [...value, role.id] : value.filter((id) => id !== role.id))}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-medium">
                  {role.display_name}
                  {!role.grantable && <Lock className="size-3.5 text-muted-foreground" aria-label="You cannot give this role" />}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {role.description ?? `${role.permissions_count} permissions`}
                  {!role.grantable && " · has permissions you do not have"}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
