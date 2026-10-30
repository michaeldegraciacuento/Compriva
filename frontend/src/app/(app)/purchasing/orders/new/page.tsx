import { Suspense } from "react";

import { OrderFormPage } from "@/modules/purchasing/components/order-form-page";

export const metadata = { title: "New purchase order · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <OrderFormPage />
    </Suspense>
  );
}
