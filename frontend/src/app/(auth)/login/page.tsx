import { Suspense } from "react";

import { LoginScreen } from "@/modules/auth/components/login-screen";

export const metadata = { title: "Sign in · Compriva" };

export default function LoginPage() {
  // useSearchParams (?next=) requires a Suspense boundary in static export.
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
