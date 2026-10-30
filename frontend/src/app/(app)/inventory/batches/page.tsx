import { Suspense } from "react";

import { BatchesPage } from "@/modules/inventory/components/batches-page";

export const metadata = { title: "Batches & expiry · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <BatchesPage />
    </Suspense>
  );
}
