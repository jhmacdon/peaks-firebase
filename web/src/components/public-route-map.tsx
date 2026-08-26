"use client";

import dynamic from "next/dynamic";
import type {
  PlanMapMarker,
  PlanMapRoute,
} from "../lib/plan-detail";

const PlanMap = dynamic(() => import("./plan-map"), { ssr: false });

export function PublicRouteMap({
  routes,
  destinations,
  path,
  className,
}: {
  routes: PlanMapRoute[];
  destinations: PlanMapMarker[];
  path: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  className?: string;
}) {
  return (
    <PlanMap
      routes={routes}
      destinations={destinations}
      path={path}
      className={className}
    />
  );
}
