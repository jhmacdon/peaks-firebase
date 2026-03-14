"use client";

import { useRef, useEffect } from "react";

interface ElevationProfileProps {
  points: { dist: number; ele: number }[];
  highlightIndex?: number | null;
  onHover?: (index: number | null) => void;
}

export default function ElevationProfile({ points, highlightIndex, onHover }: ElevationProfileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = 200;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 16, bottom: 30, left: 50 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Data range
    const maxDist = points[points.length - 1].dist;
    let minEle = Infinity, maxEle = -Infinity;
    for (const p of points) {
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
    }
    const eleRange = maxEle - minEle || 100;
    const elePad = eleRange * 0.1;
    minEle -= elePad;
    maxEle += elePad;

    const xScale = (d: number) => padding.left + (d / maxDist) * plotW;
    const yScale = (e: number) => padding.top + plotH - ((e - minEle) / (maxEle - minEle)) * plotH;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    const eleSteps = 5;
    for (let i = 0; i <= eleSteps; i++) {
      const ele = minEle + (i / eleSteps) * (maxEle - minEle);
      const y = yScale(ele);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Label
      ctx.fillStyle = "#9ca3af";
      ctx.font = "11px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(ele * 3.28084).toLocaleString()}`, padding.left - 6, y + 4);
    }

    // Axis label
    ctx.save();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.translate(12, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ft", 0, 0);
    ctx.restore();

    // Distance labels
    const distSteps = 5;
    for (let i = 0; i <= distSteps; i++) {
      const dist = (i / distSteps) * maxDist;
      const x = xScale(dist);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`${(dist / 1609.34).toFixed(1)}`, x, height - 6);
    }
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("mi", width / 2, height - 0);

    // Fill area
    ctx.beginPath();
    ctx.moveTo(xScale(points[0].dist), yScale(points[0].ele));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(xScale(points[i].dist), yScale(points[i].ele));
    }
    ctx.lineTo(xScale(points[points.length - 1].dist), padding.top + plotH);
    ctx.lineTo(xScale(points[0].dist), padding.top + plotH);
    ctx.closePath();
    ctx.fillStyle = "rgba(37, 99, 235, 0.1)";
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(xScale(points[0].dist), yScale(points[0].ele));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(xScale(points[i].dist), yScale(points[i].ele));
    }
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight point
    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < points.length) {
      const p = points[highlightIndex];
      const x = xScale(p.dist);
      const y = yScale(p.ele);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#2563eb";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Tooltip
      ctx.fillStyle = "#1f2937";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      const label = `${Math.round(p.ele * 3.28084).toLocaleString()} ft`;
      ctx.fillText(label, x, y - 10);
    }
  }, [points, highlightIndex]);

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
