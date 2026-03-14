"use client";

import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface Point {
  lat: number;
  lng: number;
  segment_number: number;
}

interface SessionMapProps {
  points: Point[];
}

const SEGMENT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
];

export default function SessionMap({ points }: SessionMapProps) {
  if (points.length === 0) return null;

  // Group points by segment
  const segments: Map<number, [number, number][]> = new Map();
  for (const p of points) {
    if (!segments.has(p.segment_number)) {
      segments.set(p.segment_number, []);
    }
    segments.get(p.segment_number)!.push([p.lat, p.lng]);
  }

  // Calculate bounds
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];

  return (
    <div className="h-80 rounded-lg overflow-hidden">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        className="h-full w-full"
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          attribution='Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
          maxZoom={17}
        />
        {Array.from(segments.entries()).map(([segNum, positions]) => (
          <Polyline
            key={segNum}
            positions={positions}
            pathOptions={{
              color: SEGMENT_COLORS[segNum % SEGMENT_COLORS.length],
              weight: 3,
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
