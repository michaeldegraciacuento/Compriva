import { Suspense } from "react";

import { CostHistoryPage } from "@/modules/purchasing/components/deliveries-pages";

export const metadata = { title: "Cost history · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <CostHistoryPage />
    </Suspense>
  );
}
