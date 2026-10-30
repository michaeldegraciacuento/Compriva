import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** A labelled on/off setting with a one-line explanation. */
export function SwitchField({ id, label, description, checked, onCheckedChange, disabled }: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description && <p id={`${id}-hint`} className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        aria-describedby={description ? `${id}-hint` : undefined}
      />
    </div>
  );
}
