"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface SegmentOverlay {
  type: "existing" | "new" | "split";
  points: { lat: number; lng: number }[];
  name: string | null;
}

interface RouteBuilderMapProps {
  points: { lat: number; lng: number }[];
  destinations: {
    id: string;
    name: string | null;
    lat: number;
    lng: number;
    selected: boolean;
  }[];
  highlightIndex?: number | null;
  turnaroundIndex?: number | null;
  segments?: SegmentOverlay[];
  onDestinationToggle?: (id: string) => void;
}

const SEGMENT_COLORS: Record<string, string> = {
  existing: "#7c3aed", // purple
  split: "#f59e0b",    // amber
  new: "#2563eb",      // blue
};

export default function RouteBuilderMap({
  points,
  destinations,
  highlightIndex,
  turnaroundIndex,
  segments,
  onDestinationToggle,
}: RouteBuilderMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const highlightMarker = useRef<L.Marker | null>(null);
  const destMarkers = useRef<Map<string, L.Marker>>(new Map());

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    const map = L.map(mapRef.current, { scrollWheelZoom: true });
    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
    }).addTo(map);

    let boundsPolyline: L.Polyline;

    if (segments && segments.length > 0) {
      // Render color-coded segments
      const allCoords: [number, number][] = [];
      for (const seg of segments) {
        const coords = seg.points.map((p) => [p.lat, p.lng] as [number, number]);
        allCoords.push(...coords);
        const color = SEGMENT_COLORS[seg.type] || "#2563eb";
        L.polyline(coords, { color, weight: 4, opacity: 0.9 })
          .bindPopup(
            `<strong>${seg.name || "New Segment"}</strong><br/>` +
            `<span style="color:${color};font-weight:600">${seg.type === "existing" ? "Existing" : seg.type === "split" ? "Partial Match" : "New"}</span>`
          )
          .addTo(map);
      }
      boundsPolyline = L.polyline(allCoords);
    } else {
      // Single polyline mode
      const coords = points.map((p) => [p.lat, p.lng] as [number, number]);
      boundsPolyline = L.polyline(coords, {
        color: "#2563eb",
        weight: 3,
        opacity: 0.9,
      }).addTo(map);
    }

    // Start marker
    const allPts = segments && segments.length > 0
      ? segments.flatMap((s) => s.points)
      : points;
    if (allPts.length > 0) {
      const startIcon = L.divIcon({
        className: "",
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#16a34a;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      L.marker([allPts[0].lat, allPts[0].lng], { icon: startIcon }).addTo(map);

      const endIcon = L.divIcon({
        className: "",
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#dc2626;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      L.marker([allPts[allPts.length - 1].lat, allPts[allPts.length - 1].lng], { icon: endIcon }).addTo(map);
    }

    // Turnaround marker (only in single-polyline mode)
    if (!segments && turnaroundIndex != null && turnaroundIndex < points.length) {
      const turnIcon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#f59e0b;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([points[turnaroundIndex].lat, points[turnaroundIndex].lng], { icon: turnIcon })
        .bindPopup("Detected turnaround")
        .addTo(map);
    }

    // Destination markers
    destMarkers.current.clear();
    for (const dest of destinations) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:20px;height:20px;border-radius:50%;background:${
          dest.selected ? "#7c3aed" : "#9ca3af"
        };border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 22h20L12 2z"/></svg>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker([dest.lat, dest.lng], { icon })
        .bindPopup(
          `<strong>${dest.name || "Unnamed"}</strong><br/>` +
          `<button onclick="window.__toggleDest__('${dest.id}')" style="margin-top:4px;padding:2px 8px;border-radius:4px;border:1px solid #ccc;cursor:pointer">${
            dest.selected ? "Remove" : "Add"
          }</button>`
        )
        .addTo(map);

      destMarkers.current.set(dest.id, marker);
    }

    // Global handler for popup buttons
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__toggleDest__ = (id: string) => {
      onDestinationToggle?.(id);
    };

    map.fitBounds(boundsPolyline.getBounds(), { padding: [30, 30] });

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__toggleDest__;
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, destinations, turnaroundIndex, segments]);

  // Update highlight marker
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (highlightMarker.current) {
      highlightMarker.current.remove();
      highlightMarker.current = null;
    }

    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < points.length) {
      const p = points[highlightIndex];
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:10px;height:10px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.4)"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });
      highlightMarker.current = L.marker([p.lat, p.lng], { icon }).addTo(map);
    }
  }, [highlightIndex, points]);

  return <div ref={mapRef} className="h-[500px] rounded-xl z-0" />;
}
