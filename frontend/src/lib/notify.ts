import { toast } from "sonner";

import { useSweetAlert, type AlertKind } from "@/components/sweet-alert";

/**
 * Feedback for what the user just did, as a centered pop-up ("sweet alert"):
 * notify.success("Customer updated", "Lola Carmen · C-0001").
 * Success and info close by themselves after a moment; warnings and errors
 * wait for OK. Errors the user must fix stay next to the form instead.
 *
 * notify.background.* are small toasts for things that happen on their own
 * (desktop sync going offline, coming back): they never block the screen.
 */
/**
 * A pop-up title is a few words: a one-string message ("New password set. Juan was
 * signed out everywhere.") becomes title "New password set" + the rest as text.
 */
export function splitMessage(title: string, text?: string): { title: string; text?: string } {
  if (text) return { title: title.replace(/\.$/, ""), text };
  const match = /^([\s\S]+?[.!?])\s+([\s\S]+)$/.exec(title);
  return match ? { title: match[1].replace(/\.$/, ""), text: match[2] } : { title: title.replace(/\.$/, "") };
}

const show = (kind: AlertKind, timer: number) => (title: string, text?: string) => useSweetAlert.getState().show({ kind, timer, ...splitMessage(title, text) });

export const notify = {
  success: show("success", 2200),
  info: show("info", 3000),
  warning: show("warning", 0),
  error: show("error", 0),

  background: {
    success: (title: string, description?: string) => toast.success(title, { description }),
    info: (title: string, description?: string) => toast.info(title, { description }),
    warning: (title: string, description?: string) => toast.warning(title, { description, duration: 8_000 }),
    error: (title: string, description?: string) => toast.error(title, { description, duration: 10_000 }),
  },
};
