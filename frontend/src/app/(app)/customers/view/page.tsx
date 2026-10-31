import { Suspense } from "react";

import { CustomerViewPage } from "@/modules/customers/components/customer-view-page";

export const metadata = { title: "Customer · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <CustomerViewPage />
    </Suspense>
  );
}
