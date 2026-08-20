"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface RouteMapProps {
  polyline6: string;
  /** Height/shape of the embed. The container owns the radius (mirrors
   * components/destination-map.tsx's contract) so a hero tile can round
   * itself without the map re-rounding its own corners underneath. */
  className?: string;
}

// Same teal as components/destination-map.tsx's ACCENT — one map-selection
// color across the site (design-tokens.md, "Accent budget"). Fixed hex
// rather than the token: painted into a Leaflet canvas layer, which never
// sees the page's CSS variables.
const ACCENT = "#46ADBC";

/** Decode a Google Polyline Algorithm string (precision 1e6) to [lat, lng][] */
function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / 1e6, lng / 1e6]);
  }

  return coords;
}

export default function RouteMap({ polyline6, className = "h-80" }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  const coords = useMemo(() => decodePolyline6(polyline6), [polyline6]);

  useEffect(() => {
    if (!mapRef.current || coords.length === 0) return;

    // Don't reinitialize if already created
    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    const map = L.map(mapRef.current, {
      scrollWheelZoom: false,
    });
    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
    }).addTo(map);

    const polyline = L.polyline(coords, {
      color: ACCENT,
      weight: 3,
      opacity: 0.9,
    }).addTo(map);

    // Start/end markers — same accent, filled vs. outlined so the two ends
    // read apart without spending a second hue.
    const startIcon = L.divIcon({
      className: "",
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${ACCENT};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    const endIcon = L.divIcon({
      className: "",
      html: `<div style="width:12px;height:12px;border-radius:50%;background:white;border:2px solid ${ACCENT};box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    L.marker(coords[0], { icon: startIcon }).addTo(map);
    L.marker(coords[coords.length - 1], { icon: endIcon }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [30, 30] });

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [coords]);

  if (coords.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-fill text-sm text-muted ${className}`.trim()}>
        No route geometry available
      </div>
    );
  }

  return <div ref={mapRef} className={`map-embed bg-fill ${className}`.trim()} />;
}
