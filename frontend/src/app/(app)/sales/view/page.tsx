import { Suspense } from "react";

import { SaleViewPage } from "@/modules/sales/components/sale-view-page";

export const metadata = { title: "Sale · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <SaleViewPage />
    </Suspense>
  );
}
