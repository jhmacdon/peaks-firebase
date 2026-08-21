"use client";

import dynamic from "next/dynamic";
import { useElevationProfileColors } from "../use-elevation-profile-colors";

// The canvas chart touches window/ResizeObserver at draw time, so it can
// only render client-side — same reason every Leaflet embed in this app is
// a dynamic(..., { ssr: false }) island.
const ElevationProfile = dynamic(() => import("../elevation-profile"), {
  ssr: false,
});

/** Route detail's elevation profile. The token resolving and the
 * `prefers-color-scheme` listener live in useElevationProfileColors, shared
 * with the activity page's playback chart. */
export function RouteElevationProfile({
  points,
}: {
  points: { dist: number; ele: number }[];
}) {
  const colors = useElevationProfileColors();

  return <ElevationProfile points={points} colors={colors} />;
}
