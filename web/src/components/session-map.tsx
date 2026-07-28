"use client";

import { CircleMarker, MapContainer, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface Point {
  lat: number;
  lng: number;
  segment_number: number;
}

interface SessionMapProps {
  points: Point[];
  activeIndex?: number | null;
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

function groupPositions(points: Point[]): Map<number, [number, number][]> {
  const segments: Map<number, [number, number][]> = new Map();
  for (const point of points) {
    const positions = segments.get(point.segment_number) ?? [];
    positions.push([point.lat, point.lng]);
    segments.set(point.segment_number, positions);
  }
  return segments;
}

export default function SessionMap({
  points,
  activeIndex = null,
}: SessionMapProps) {
  if (points.length === 0) return null;

  const clampedActiveIndex =
    activeIndex == null
      ? null
      : Math.max(0, Math.min(activeIndex, points.length - 1));
  const segments = groupPositions(points);
  const completedSegments =
    clampedActiveIndex == null
      ? new Map<number, [number, number][]>()
      : groupPositions(points.slice(0, clampedActiveIndex + 1));
  const activePoint =
    clampedActiveIndex == null ? null : points[clampedActiveIndex];

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
        {clampedActiveIndex == null
          ? Array.from(segments.entries()).map(([segNum, positions]) => (
              <Polyline
                key={segNum}
                positions={positions}
                pathOptions={{
                  color: SEGMENT_COLORS[segNum % SEGMENT_COLORS.length],
                  weight: 3,
                }}
              />
            ))
          : (
              <>
                {Array.from(segments.entries()).map(([segNum, positions]) => (
                  <Polyline
                    key={`remaining-${segNum}`}
                    positions={positions}
                    pathOptions={{
                      color: "#64748b",
                      opacity: 0.42,
                      weight: 3,
                    }}
                  />
                ))}
                {Array.from(completedSegments.entries()).map(
                  ([segNum, positions]) => (
                    <Polyline
                      key={`complete-${segNum}`}
                      positions={positions}
                      pathOptions={{
                        color:
                          SEGMENT_COLORS[segNum % SEGMENT_COLORS.length],
                        opacity: 0.95,
                        weight: 4,
                      }}
                    />
                  )
                )}
                {activePoint && (
                  <CircleMarker
                    center={[activePoint.lat, activePoint.lng]}
                    radius={7}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: "#0f766e",
                      fillOpacity: 1,
                      opacity: 1,
                      weight: 3,
                    }}
                  />
                )}
              </>
            )}
      </MapContainer>
    </div>
  );
}
