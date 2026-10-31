import { Suspense } from "react";

import { UserViewPage } from "@/modules/identity/components/user-view-page";

export const metadata = { title: "User · Compriva" };

/** Suspense: the page reads the query string (useSearchParams), which the static export resolves on the client. */
export default function Page() {
  return (
    <Suspense>
      <UserViewPage />
    </Suspense>
  );
}
