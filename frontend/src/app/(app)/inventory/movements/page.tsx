import { Suspense } from "react";

import { MovementsPage } from "@/modules/inventory/components/movements-page";

export const metadata = { title: "Stock history · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <MovementsPage />
    </Suspense>
  );
}
