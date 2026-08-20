"use client";

import { useEffect, useRef } from "react";

/** Resolved token values the canvas paints with. Canvas 2D never sees CSS
 * custom properties, so a caller resolves the design tokens (`--color-ink`,
 * `--color-accent-text`, etc. — real :root-scoped properties, see
 * web/docs/design-tokens.md) via `getComputedStyle` and hands over the
 * literal color strings. See components/route/route-elevation-profile.tsx
 * for the resolving wrapper — it re-reads on a
 * `prefers-color-scheme` change so the chart repaints when the OS theme
 * flips, which is what makes this "dark-mode aware". */
export interface ElevationProfileColors {
  /** Primary text — the filled area under the line, always at 15% alpha
   * (design-tokens.md-style "ink 15% area" spec; this component applies
   * the alpha, callers just pass the resolved `--color-ink`). */
  ink: string;
  /** Line stroke and the highlighted point — `--color-accent-text`. */
  accentText: string;
  /** Grid lines — `--color-hairline`. */
  hairline: string;
  /** Axis tick labels — `--color-muted`. */
  muted: string;
  /** Page background — used as the highlighted point's ring so it reads
   * against the line color in both themes. */
  page: string;
}

interface ElevationProfileProps {
  points: { dist: number; ele: number }[];
  /** Optional — the admin route builder and session viewer render this
   * chart without theme awareness and don't pass one, so it falls back to
   * the original fixed light-mode palette (unchanged look for them). Task
   * 14's public route page always passes the resolved tokens; see
   * components/route/route-elevation-profile.tsx. */
  colors?: ElevationProfileColors;
  highlightIndex?: number | null;
  onHover?: (index: number | null) => void;
}

const DEFAULT_COLORS: ElevationProfileColors = {
  ink: "#1f2937",
  accentText: "#2563eb",
  hairline: "#e5e7eb",
  muted: "#9ca3af",
  page: "#ffffff",
};

// Generic monospace stack rather than the Geist Mono utility class: canvas
// `ctx.font` strings can't consume a next/font CSS variable (design-tokens.md
// explains why `font-mono`/`var(--font-mono)` doesn't resolve outside a
// class on an element carrying next/font's `.variable`), and there's no
// canvas element to hang that class on. The UI monospace stack reads close
// enough to Geist Mono for axis tick labels.
const MONO_FONT = "ui-monospace, SFMono-Regular, 'Geist Mono', Menlo, monospace";

/** "#21211f" → "rgba(33, 33, 31, 0.15)". Silently falls back to full
 * opacity on an unparseable value rather than throwing mid-render — a
 * resolved-token miss should degrade, not blank the chart. */
function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return hex;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function ElevationProfile({
  points,
  colors = DEFAULT_COLORS,
  highlightIndex,
  onHover,
}: ElevationProfileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length < 2) return;

    function draw() {
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = 200;
      if (width === 0) return;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const padding = { top: 20, right: 16, bottom: 30, left: 50 };
      const plotW = width - padding.left - padding.right;
      const plotH = height - padding.top - padding.bottom;

      const measuredDistance = points[points.length - 1].dist;
      const maxDist = measuredDistance > 0 ? measuredDistance : 1;
      let minEle = Infinity;
      let maxEle = -Infinity;
      for (const p of points) {
        if (p.ele < minEle) minEle = p.ele;
        if (p.ele > maxEle) maxEle = p.ele;
      }
      const eleRange = maxEle - minEle || 100;
      const elePad = eleRange * 0.1;
      minEle -= elePad;
      maxEle += elePad;

      const xScale = (d: number) => padding.left + (d / maxDist) * plotW;
      const yScale = (e: number) =>
        padding.top + plotH - ((e - minEle) / (maxEle - minEle)) * plotH;

      ctx.clearRect(0, 0, width, height);

      // Hairline grid + mono elevation labels.
      ctx.strokeStyle = colors.hairline;
      ctx.lineWidth = 1;
      const eleSteps = 5;
      for (let i = 0; i <= eleSteps; i++) {
        const ele = minEle + (i / eleSteps) * (maxEle - minEle);
        const y = yScale(ele);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = colors.muted;
        ctx.font = `11px ${MONO_FONT}`;
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(ele * 3.28084).toLocaleString()}`, padding.left - 6, y + 4);
      }

      ctx.save();
      ctx.fillStyle = colors.muted;
      ctx.font = `10px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.translate(12, padding.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("ft", 0, 0);
      ctx.restore();

      const distSteps = 5;
      for (let i = 0; i <= distSteps; i++) {
        const dist = (i / distSteps) * maxDist;
        const x = xScale(dist);
        ctx.fillStyle = colors.muted;
        ctx.font = `11px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(`${(dist / 1609.34).toFixed(1)}`, x, height - 6);
      }
      ctx.fillStyle = colors.muted;
      ctx.font = `10px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("mi", width / 2, height - 0);

      // Ink-at-15% fill under an accent-text line (design-tokens.md-style
      // "ink 15% area, accent-text line" spec).
      ctx.beginPath();
      ctx.moveTo(xScale(points[0].dist), yScale(points[0].ele));
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(xScale(points[i].dist), yScale(points[i].ele));
      }
      ctx.lineTo(xScale(points[points.length - 1].dist), padding.top + plotH);
      ctx.lineTo(xScale(points[0].dist), padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(colors.ink, 0.15);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(xScale(points[0].dist), yScale(points[0].ele));
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(xScale(points[i].dist), yScale(points[i].ele));
      }
      ctx.strokeStyle = colors.accentText;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < points.length) {
        const p = points[highlightIndex];
        const x = xScale(p.dist);
        const y = yScale(p.ele);

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = colors.accentText;
        ctx.fill();
        ctx.strokeStyle = colors.page;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = colors.ink;
        ctx.font = `500 11px ${MONO_FONT}`;
        ctx.textAlign = "center";
        const label = `${Math.round(p.ele * 3.28084).toLocaleString()} ft`;
        ctx.fillText(label, x, y - 10);
      }
    }

    draw();

    // Container resize handling — the chart used to draw once against
    // whatever width existed on mount, which left it stale after a sidebar
    // reflow, a font-load layout shift, or a viewport resize.
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [points, highlightIndex, colors]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!onHover || !containerRef.current || points.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = { left: 50, right: 16 };
    const plotW = rect.width - padding.left - padding.right;
    const ratio = (x - padding.left) / plotW;

    if (ratio < 0 || ratio > 1) {
      onHover(null);
      return;
    }

    const targetDist = ratio * points[points.length - 1].dist;
    let closest = 0;
    let minDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(points[i].dist - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closest = i;
      }
    }
    onHover(closest);
  };

  return (
    <div ref={containerRef} className="w-full" onMouseMove={handleMouseMove} onMouseLeave={() => onHover?.(null)}>
      <canvas ref={canvasRef} className="w-full cursor-crosshair" />
    </div>
  );
}
