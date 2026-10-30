import { Suspense } from "react";

import { OrderViewPage } from "@/modules/purchasing/components/order-view-page";

export const metadata = { title: "Purchase order · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <OrderViewPage />
    </Suspense>
  );
}
