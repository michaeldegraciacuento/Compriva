import { Suspense } from "react";

import { ReportsPage } from "@/modules/reports/components/reports-page";

export const metadata = { title: "Reports · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <ReportsPage />
    </Suspense>
  );
}
