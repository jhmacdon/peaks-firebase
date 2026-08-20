import type { CSSProperties } from "react";
import { generateContourField, type ContourField } from "../lib/contour-rings";

// ContourArt — the hero texture: a generated topographic map of a single
// summit. Server-renderable, no client JavaScript. Geometry comes from a
// seeded generator (lib/contour-rings.ts), so the same seed always draws the
// same peak and Task 18's landing pages can pick their own by passing one.
//
// Weight is deliberately low: rings sit on --color-hairline, the one accent
// ring and its summit dot are the whole of the accent spend (design-tokens.md
// "Accent budget"). Both tokens repaint themselves in dark mode, so there is
// no `dark:` variant here.
//
// Decorative: aria-hidden, and it must be positioned by the caller (the page
// clips it) — this component sets no size of its own beyond `className`.

/** The default peak. Changing it reshapes the landing hero. */
export const HERO_CONTOUR_SEED = 20260819;

const fields = new Map<number, ContourField>();

function contourField(seed: number): ContourField {
  const cached = fields.get(seed);
  if (cached) return cached;
  const field = generateContourField({ seed });
  fields.set(seed, field);
  return field;
}

export function ContourArt({
  className = "",
  seed = HERO_CONTOUR_SEED,
  accentRing = 2,
  animate = true,
}: {
  className?: string;
  seed?: number;
  /** Which ring, counting out from the summit, carries the accent stroke. */
  accentRing?: number;
  /** Draw the accent ring in once on load. Reduced-motion visitors get the
   * finished ring either way — see `.contour-draw` in globals.css. */
  animate?: boolean;
}) {
  const field = contourField(seed);
  if (field.rings.length === 0) return null;

  const accentIndex = Math.min(Math.max(accentRing, 0), field.rings.length - 1);
  const accent = field.rings[accentIndex];
  // The dash pattern must be at least as long as the curve, which runs a
  // little longer than the polyline through its points.
  const dashLength = Math.ceil(accent.length * 1.02);

  return (
    <svg
      viewBox={`0 0 ${field.size} ${field.size}`}
      className={className}
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      <g fill="none" stroke="var(--color-hairline)" strokeWidth={1.25}>
        {field.rings.map((ring, index) =>
          index === accentIndex ? null : <path key={index} d={ring.d} />
        )}
      </g>
      <path
        d={accent.d}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.75}
        strokeLinecap="round"
        className={animate ? "contour-draw" : undefined}
        style={
          animate
            ? ({ "--contour-length": String(dashLength) } as CSSProperties)
            : undefined
        }
      />
      <circle cx={accent.cx} cy={accent.cy} r={3.25} fill="var(--color-accent)" />
    </svg>
  );
}
