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
  /** Height (and any clipping) of the embed — the container owns the shape. */
  className?: string;
}

// Same teal as route-map.tsx / destination-map.tsx / explore-map.tsx — one
// map colour across the site (design-tokens.md, "Accent budget"). Fixed hex
// rather than the token: Leaflet paints into its own layers, which never see
// the page's CSS variables.
//
// This used to be a seven-hue rainbow, one colour per recording segment. The
// segments are pause/resume breaks in one activity, not seven different
// things, and the break is already visible as a gap between polylines — so
// the rainbow was spending six colours to say nothing.
//
// During playback the part not yet reached is the same teal held back to
// 40%: the track is the subject of this map, and washing it out to grey (as
// it was) left a parked scrubber showing a nearly invisible route on top of
// a busy topo basemap.
const TRACK = "#46ADBC";
const TRACK_PENDING_OPACITY = 0.4;

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
  className = "h-80",
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
    // No radius here — the section container that holds the map owns it, so
    // a rounded corner never gets drawn twice (same contract as
    // components/route-map.tsx).
    <div className={className}>
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        className="map-embed h-full w-full"
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
                pathOptions={{ color: TRACK, weight: 3 }}
              />
            ))
          : (
              <>
                {Array.from(segments.entries()).map(([segNum, positions]) => (
                  <Polyline
                    key={`remaining-${segNum}`}
                    positions={positions}
                    pathOptions={{
                      color: TRACK,
                      opacity: TRACK_PENDING_OPACITY,
                      weight: 3,
                    }}
                  />
                ))}
                {Array.from(completedSegments.entries()).map(
                  ([segNum, positions]) => (
                    <Polyline
                      key={`complete-${segNum}`}
                      positions={positions}
                      pathOptions={{ color: TRACK, opacity: 1, weight: 4 }}
                    />
                  )
                )}
                {activePoint && (
                  <CircleMarker
                    center={[activePoint.lat, activePoint.lng]}
                    radius={7}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: TRACK,
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
