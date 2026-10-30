import { Suspense } from "react";

import { DeliveryViewPage } from "@/modules/purchasing/components/deliveries-pages";

export const metadata = { title: "Delivery · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <DeliveryViewPage />
    </Suspense>
  );
}
