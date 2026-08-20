"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ElevationProfileColors } from "../elevation-profile";

// The canvas chart touches window/ResizeObserver at draw time, so it can
// only render client-side — same reason every Leaflet embed in this app is
// a dynamic(..., { ssr: false }) island.
const ElevationProfile = dynamic(() => import("../elevation-profile"), {
  ssr: false,
});

// Light-mode token values, hardcoded as the pre-hydration/no-JS fallback —
// matches globals.css's :root block. The real values are re-read from the
// DOM once mounted (see readResolvedColors below), so this only paints for
// an instant on first load.
const FALLBACK_COLORS: ElevationProfileColors = {
  ink: "#21211f",
  accentText: "#1d7a8a",
  hairline: "#edece8",
  muted: "#64635e",
  page: "#ffffff",
};

const TOKEN_PROPERTIES: Record<keyof ElevationProfileColors, string> = {
  ink: "--color-ink",
  accentText: "--color-accent-text",
  hairline: "--color-hairline",
  muted: "--color-muted",
  page: "--color-page",
};

/** Reads the live computed values of the color tokens this chart needs.
 * These are real `:root`-scoped custom properties (design-tokens.md), so
 * `getComputedStyle` already returns whichever theme (light or dark) is
 * currently active — this function doesn't need to know which one. */
function readResolvedColors(): ElevationProfileColors {
  const styles = getComputedStyle(document.documentElement);
  const resolved = { ...FALLBACK_COLORS };
  for (const key of Object.keys(TOKEN_PROPERTIES) as (keyof ElevationProfileColors)[]) {
    const value = styles.getPropertyValue(TOKEN_PROPERTIES[key]).trim();
    if (value) resolved[key] = value;
  }
  return resolved;
}

/** Route detail's elevation profile: resolves the design tokens the canvas
 * needs into literal color strings and keeps them current across a
 * `prefers-color-scheme` flip, so the chart repaints instead of staying
 * pinned to whichever theme was active on first paint. */
export function RouteElevationProfile({
  points,
}: {
  points: { dist: number; ele: number }[];
}) {
  const [colors, setColors] = useState<ElevationProfileColors>(FALLBACK_COLORS);

  useEffect(() => {
    setColors(readResolvedColors());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setColors(readResolvedColors());
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return <ElevationProfile points={points} colors={colors} />;
}
