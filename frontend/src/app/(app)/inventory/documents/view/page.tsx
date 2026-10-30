import { Suspense } from "react";

import { DocumentViewPage } from "@/modules/inventory/components/document-view-page";

export const metadata = { title: "Stock document · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <DocumentViewPage />
    </Suspense>
  );
}
