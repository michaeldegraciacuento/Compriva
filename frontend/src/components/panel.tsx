import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The standard content container: a card with a titled header, optional
 * header action and footer. `flush` removes content padding for tables and
 * lists that run edge to edge.
 */
export function Panel({ title, description, action, footer, flush = false, className, children, ...rest }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  return (
    <Card className={cn("gap-4", className)} {...rest}>
      <CardHeader>
        <CardTitle className="text-[0.95rem] font-semibold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("flex-1", flush && "px-0")}>{children}</CardContent>
      {footer && <CardFooter className="border-t bg-muted/40 py-3 text-sm">{footer}</CardFooter>}
    </Card>
  );
}
