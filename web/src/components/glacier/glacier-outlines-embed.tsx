"use client";

import dynamic from "next/dynamic";

// Leaflet reads `window` at import; the hub pages are server components.
const GlacierOutlinesMap = dynamic(() => import("./glacier-outlines-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-fill" />,
});

export default GlacierOutlinesMap;
