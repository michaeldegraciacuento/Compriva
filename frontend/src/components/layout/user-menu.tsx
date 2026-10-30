"use client";

import { Activity, ChevronDown, LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { useCan, useSession } from "@/modules/auth/hooks";
import { useAuthStore } from "@/modules/auth/store";

export function UserMenu() {
  const router = useRouter();
  const session = useSession();
  const logout = useAuthStore((state) => state.logout);
  const canSeeSystem = useCan("settings.manage");

  if (!session) return null;
  const role = session.roles.map((r) => r.replace("_", " ")).join(", ");

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-testid="user-menu"
      >
        <Avatar size="sm">
          <AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-700">{initials(session.user.name)}</AvatarFallback>
        </Avatar>
        <span className="hidden leading-tight sm:grid">
          <span className="text-sm font-medium">{session.user.name}</span>
          <span className="text-xs text-muted-foreground capitalize">{role}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid">
            <span className="font-medium text-foreground">{session.user.name}</span>
            <span className="font-normal text-muted-foreground">@{session.user.username}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserRound aria-hidden /> My profile
        </DropdownMenuItem>
        {canSeeSystem && (
          <DropdownMenuItem onClick={() => router.push("/system")}>
            <Activity aria-hidden /> System status
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} data-testid="sign-out">
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
