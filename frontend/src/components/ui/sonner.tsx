"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** The app's toast area (sonner), styled with the design tokens. Mounted once in the root layout. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      closeButton
      visibleToasts={4}
      icons={{
        success: <CircleCheck className="size-4 text-success" aria-hidden />,
        error: <CircleAlert className="size-4 text-danger" aria-hidden />,
        warning: <TriangleAlert className="size-4 text-warning" aria-hidden />,
        info: <Info className="size-4 text-info" aria-hidden />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-lg font-sans",
          description: "!text-muted-foreground",
          closeButton: "!border-border !bg-popover !text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
      {...props}
    />
  );
}
