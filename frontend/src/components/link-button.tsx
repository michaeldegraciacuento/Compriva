import Link from "next/link";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/** A link styled as a button (Base UI needs nativeButton={false} when rendering an <a>). */
export function LinkButton({ href, ...props }: Omit<ComponentProps<typeof Button>, "render" | "nativeButton"> & { href: string }) {
  return <Button nativeButton={false} render={<Link href={href} />} {...props} />;
}
