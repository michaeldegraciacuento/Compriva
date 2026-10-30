import { Suspense } from "react";

import { ProductEditPage } from "@/modules/catalog/components/product-edit-page";

export const metadata = { title: "Edit product · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <ProductEditPage />
    </Suspense>
  );
}
