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

/** A second series drawn as THE coloured line, on its own right-hand axis —
 * speed or heart rate over the same distance axis as the elevation. When one
 * is supplied the elevation stops being the measured thing and becomes grey
 * context: its area still fills the plot, but the accent line belongs to the
 * metric ("grey for context, one hue for the measured thing" —
 * docs/audits/2026-08-19-strava-signed-in.md §5). */
export interface ElevationProfileMetric {
  /** Parallel to `points`; null where that point carries no sample. */
  values: (number | null)[];
  /** Right-axis tick text for a value, e.g. `(v) => v.toFixed(1)`. */
  formatTick: (value: number) => string;
  /** Axis caption printed under the right-hand ticks, e.g. "mph". */
  unit: string;
}

interface ElevationProfileProps {
  points: { dist: number; ele: number }[];
  /** Optional — the admin route builder renders this chart without theme
   * awareness and doesn't pass one, so it falls back to the original fixed
   * light-mode palette (unchanged look for it). Task 14's public route page
   * and Task 17's activity page pass the resolved tokens; see
   * components/use-elevation-profile-colors.ts. */
  colors?: ElevationProfileColors;
  metric?: ElevationProfileMetric | null;
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
  metric = null,
  highlightIndex,
  onHover,
}: ElevationProfileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length < 2) return;

    // A metric only counts once it has two points to draw a line between;
    // below that the chart falls back to plotting the elevation itself.
    const metricValues =
      metric && metric.values.length === points.length ? metric.values : null;
    let metricMin = Infinity;
    let metricMax = -Infinity;
    let metricCount = 0;
    if (metricValues) {
      for (const value of metricValues) {
        if (value == null || !Number.isFinite(value)) continue;
        metricCount += 1;
        if (value < metricMin) metricMin = value;
        if (value > metricMax) metricMax = value;
      }
    }
    const drawMetric = metricValues != null && metricCount >= 2;
    if (drawMetric && metricMax - metricMin < 1e-9) {
      // A flat series would divide by zero; give it a nominal band so the
      // line lands mid-plot instead of vanishing.
      metricMin -= 1;
      metricMax += 1;
    }

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

      // Left gutter fits a five-digit foot label (six mono glyphs ≈ 40px)
      // beside the rotated "ft" caption at x=10 without the two touching;
      // at the old 50 they overlapped on any peak above 10,000 ft. The right
      // gutter only widens when a second axis needs to live there.
      const padding = { top: 20, right: drawMetric ? 50 : 16, bottom: 30, left: 62 };
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
      const metricScale = (value: number) =>
        padding.top + plotH - ((value - metricMin) / (metricMax - metricMin)) * plotH;

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

        // Second axis, same gridlines: the metric reads off the right edge
        // so elevation keeps the left one it has always had.
        if (drawMetric && metric) {
          const value = metricMin + (i / eleSteps) * (metricMax - metricMin);
          ctx.textAlign = "left";
          ctx.fillText(metric.formatTick(value), width - padding.right + 6, y + 4);
        }
      }

      if (drawMetric && metric) {
        ctx.save();
        ctx.fillStyle = colors.muted;
        ctx.font = `10px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.translate(width - 10, padding.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(metric.unit, 0, 0);
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = colors.muted;
      ctx.font = `10px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.translate(12, padding.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("ft", 0, 0);
      ctx.restore();

      // Ticks then caption, both inside the 30px bottom gutter. The caption
      // used to sit on the canvas's own bottom edge, where its descenders
      // were simply cut off.
      const distSteps = 5;
      for (let i = 0; i <= distSteps; i++) {
        const dist = (i / distSteps) * maxDist;
        const x = xScale(dist);
        ctx.fillStyle = colors.muted;
        ctx.font = `11px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(`${(dist / 1609.34).toFixed(1)}`, x, height - 17);
      }
      ctx.fillStyle = colors.muted;
      ctx.font = `10px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("mi", width / 2, height - 4);

      // Ink-at-15% fill under the elevation (design-tokens.md-style "ink 15%
      // area" spec).
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

      // Exactly one accent line, on whichever series is the measured thing.
      // With a metric selected the elevation keeps only its grey area, so
      // two saturated series never compete (audit §5.1).
      ctx.strokeStyle = colors.accentText;
      ctx.lineWidth = 2;
      if (drawMetric && metricValues) {
        // Gaps in the samples break the line rather than bridging a
        // stretch the recorder never measured.
        let penDown = false;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const value = metricValues[i];
          if (value == null || !Number.isFinite(value)) {
            penDown = false;
            continue;
          }
          const x = xScale(points[i].dist);
          const y = metricScale(value);
          if (penDown) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          penDown = true;
        }
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(xScale(points[0].dist), yScale(points[0].ele));
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(xScale(points[i].dist), yScale(points[i].ele));
        }
        ctx.stroke();
      }

      if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < points.length) {
        const p = points[highlightIndex];
        const metricValue =
          drawMetric && metricValues ? metricValues[highlightIndex] : null;
        // The dot rides the drawn line. When the metric has no sample at the
        // cursor there is no line to ride, so it falls back to the elevation.
        const onMetric =
          metricValue != null && Number.isFinite(metricValue) && metric != null;
        const x = xScale(p.dist);
        const y = onMetric ? metricScale(metricValue as number) : yScale(p.ele);

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
        const label = onMetric
          ? `${metric!.formatTick(metricValue as number)} ${metric!.unit}`
          : `${Math.round(p.ele * 3.28084).toLocaleString()} ft`;
        // Held inside the plot: a playback cursor parked at 0:00 sits on the
        // left edge, and a centred label there would print straight through
        // the y-axis ticks.
        const labelHalfWidth = ctx.measureText(label).width / 2 + 2;
        const labelX = Math.min(
          Math.max(x, padding.left + labelHalfWidth),
          width - padding.right - labelHalfWidth
        );
        ctx.fillText(label, labelX, y - 10);
      }
    }

    draw();

    // Container resize handling — the chart used to draw once against
    // whatever width existed on mount, which left it stale after a sidebar
    // reflow, a font-load layout shift, or a viewport resize.
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [points, highlightIndex, colors, metric]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!onHover || !containerRef.current || points.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Mirrors the draw padding above — the right gutter widens for a second
    // axis, and the hover mapping has to widen with it.
    const padding = { left: 62, right: metric ? 50 : 16 };
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
