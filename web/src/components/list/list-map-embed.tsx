"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so the map can only load in the
// browser. `next/dynamic` with `ssr: false` is a client-component-only API,
// which is the whole reason this one-file island exists: the list page
// itself is a server component, and everything else on it renders on the
// server.
const ListMap = dynamic(() => import("../list-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-fill" />,
});

export default ListMap;
