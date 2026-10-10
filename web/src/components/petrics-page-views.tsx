"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pageView } from "../lib/analytics";

/** Tracks `Page Viewed` on each route change. Renders nothing. */
export function PetricsPageViews() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) pageView(pathname);
  }, [pathname]);

  return null;
}
