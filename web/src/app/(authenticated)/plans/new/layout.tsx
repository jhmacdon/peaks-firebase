import type { ReactNode } from "react";

/** Keep legacy links and their route/place query intact through sign-in. */
export default function LegacyNewTripLayout({ children }: { children: ReactNode }) {
  return children;
}
