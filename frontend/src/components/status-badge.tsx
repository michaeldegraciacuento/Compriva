import { AlertTriangle, CheckCircle2, Info, type LucideIcon, MinusCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, { className: string; icon: LucideIcon }> = {
  success: { className: "bg-success-soft text-success", icon: CheckCircle2 },
  warning: { className: "bg-warning-soft text-warning", icon: AlertTriangle },
  danger: { className: "bg-danger-soft text-danger", icon: XCircle },
  info: { className: "bg-info-soft text-info", icon: Info },
  neutral: { className: "bg-muted text-muted-foreground", icon: MinusCircle },
};

/**
 * Status is never color alone: every badge has an icon and a text label.
 * Status tones are reserved for state and never used as chart series colors.
 */
export function StatusBadge({ tone, children, icon, className }: {
  tone: Tone;
  children: ReactNode;
  icon?: LucideIcon | false;
  className?: string;
}) {
  const { className: toneClass, icon: DefaultIcon } = TONES[tone];
  const Icon = icon === false ? null : (icon ?? DefaultIcon);

  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap", toneClass, className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}
