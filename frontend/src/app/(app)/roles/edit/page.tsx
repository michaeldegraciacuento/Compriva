import { Suspense } from "react";

import { RoleEditPage } from "@/modules/identity/components/role-edit-page";

export const metadata = { title: "Role · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <RoleEditPage />
    </Suspense>
  );
}
