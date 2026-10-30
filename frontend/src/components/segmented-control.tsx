"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Single-choice control for filters such as a date range. Exactly one option is always selected. */
export function SegmentedControl<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next: string[]) => {
        // Base UI reports [] when the active item is clicked again: keep the current choice.
        if (next.length > 0) onChange(next[next.length - 1] as T);
      }}
      className="rounded-lg border bg-card p-0.5"
      spacing={0}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="sm"
          className="px-3 text-muted-foreground data-[pressed]:bg-accent data-[pressed]:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
