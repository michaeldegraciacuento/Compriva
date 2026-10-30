import { cn } from "@/lib/utils";

export type MeterTone = "success" | "warning" | "danger";

const FILL: Record<MeterTone, string> = {
  success: "bg-status-good",
  warning: "bg-status-warning",
  danger: "bg-status-critical",
};

const TRACK: Record<MeterTone, string> = {
  success: "bg-success-soft",
  warning: "bg-warning-soft",
  danger: "bg-danger-soft",
};

/**
 * Horizontal level meter. The fill carries severity; the track is a lighter
 * step of the same hue so the state reads across the whole bar. Always shown
 * next to the numbers it represents (never the only way to read the value).
 */
export function Meter({ value, max, tone, label }: { value: number; max: number; tone: MeterTone; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("h-1.5 w-full overflow-hidden rounded-full", TRACK[tone])}
    >
      <div className={cn("h-full rounded-full", FILL[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}
