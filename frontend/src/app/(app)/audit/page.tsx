import { Suspense } from "react";

import { AuditPage } from "@/modules/system/components/audit-page";

export const metadata = { title: "Audit log · Compriva" };

/** Suspense: the page reads the query string (a record's history), resolved on the client in the static export. */
export default function Page() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
