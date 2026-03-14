"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  getDestinationsInViewport,
  getRoutesInViewport,
  type SearchDestination,
  type ViewportRoute,
} from "@/lib/actions/search";

const ExploreMap = dynamic(() => import("@/components/explore-map"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800"
      style={{ height: "calc(100vh - 57px)" }}
    >
      <span className="text-gray-500">Loading map...</span>
    </div>
  ),
});

interface Viewport {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export default function MapPage() {
  const [destinations, setDestinations] = useState<SearchDestination[]>([]);
  const [routes, setRoutes] = useState<ViewportRoute[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleViewportChange = useCallback((bounds: Viewport) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const [dests, rts] = await Promise.all([
        getDestinationsInViewport(
          bounds.minLat,
          bounds.maxLat,
          bounds.minLng,
          bounds.maxLng
        ),
        getRoutesInViewport(
          bounds.minLat,
          bounds.maxLat,
          bounds.minLng,
          bounds.maxLng
        ),
      ]);
      setDestinations(dests);
      setRoutes(rts);
    }, 300);
  }, []);

  const mapDestinations = destinations
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      elevation: d.elevation,
      lat: d.lat!,
      lng: d.lng!,
      features: d.features,
    }));

  const mapRoutes = routes.map((r) => ({
    id: r.id,
    name: r.name,
    polyline6: r.polyline6,
  }));

  return (
    <ExploreMap
      destinations={mapDestinations}
      routes={mapRoutes}
      onViewportChange={handleViewportChange}
    />
  );
}
