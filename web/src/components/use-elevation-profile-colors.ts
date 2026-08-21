"use client";

import { useEffect, useState } from "react";
import type { ElevationProfileColors } from "./elevation-profile";

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

/** Reads the live computed values of the color tokens the canvas chart
 * needs. These are real `:root`-scoped custom properties (design-tokens.md),
 * so `getComputedStyle` already returns whichever theme (light or dark) is
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

/** Resolves the design tokens the elevation canvas needs into literal color
 * strings and keeps them current across a `prefers-color-scheme` flip, so a
 * chart repaints instead of staying pinned to whichever theme was active on
 * first paint. Canvas 2D never sees CSS custom properties, which is why the
 * caller has to hand over resolved strings at all.
 *
 * Written for the route page in Task 14 and lifted out of
 * route/route-elevation-profile.tsx in Task 17, when the activity page's
 * playback chart needed the same thing. */
export function useElevationProfileColors(): ElevationProfileColors {
  const [colors, setColors] = useState<ElevationProfileColors>(FALLBACK_COLORS);

  useEffect(() => {
    setColors(readResolvedColors());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setColors(readResolvedColors());
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return colors;
}
