"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so the map can only load in the
// browser (same contract as components/destination/destination-map-embed.tsx).
const RouteMap = dynamic(() => import("../route-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-fill" />,
});

export default RouteMap;
