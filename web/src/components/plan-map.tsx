"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface PlanMapRoute {
  id: string;
  name: string | null;
  polyline6: string;
}

interface PlanMapMarker {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
}

interface PlanMapProps {
  routes: PlanMapRoute[];
  destinations: PlanMapMarker[];
  /** The plan's own matched track (`plans.path`), when `processPlan` has run
   * against client-supplied geometry — rare (today, only iOS's GPX-import
   * flow supplies one). Drawn as the primary line; the routes below it are
   * drawn a shade lighter so the two don't fight when they overlap. */
  path?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  className?: string;
}

const TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTRIBUTION =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

// Same teal as components/route-map.tsx's/area-map.tsx's ACCENT — one map
// selection color across the site (design-tokens.md, "Accent budget").
// Fixed hex rather than the token: painted into a Leaflet canvas/SVG layer,
// which never sees the page's CSS variables.
const ACCENT = "#46ADBC";

export default function PlanMap({
  routes,
  destinations,
  path,
  className = "h-80 w-full sm:h-96",
}: PlanMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  const routesJson = JSON.stringify(routes);
  const destinationsJson = JSON.stringify(destinations);
  const pathJson = path ? JSON.stringify(path) : "";

  useEffect(() => {
    if (!mapRef.current) return;

    mapInstance.current?.remove();

    const map = L.map(mapRef.current, { scrollWheelZoom: false });
    mapInstance.current = map;

    L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTRIBUTION,
      maxZoom: 17,
      detectRetina: true,
    }).addTo(map);

    const parsedRoutes = JSON.parse(routesJson) as PlanMapRoute[];
    const parsedDestinations = JSON.parse(destinationsJson) as PlanMapMarker[];
    const parsedPath = pathJson
      ? (JSON.parse(pathJson) as GeoJSON.LineString | GeoJSON.MultiLineString)
      : null;

    const bounds = L.latLngBounds([]);

    for (const route of parsedRoutes) {
      const coordinates = decodePolyline6(route.polyline6);
      if (coordinates.length < 2) continue;
      const line = L.polyline(coordinates, {
        color: ACCENT,
        weight: 3,
        opacity: parsedPath ? 0.55 : 0.85,
      }).addTo(map);
      line.bindTooltip(textNode(route.name ?? "Route"), { sticky: true });
      bounds.extend(line.getBounds());
    }

    if (parsedPath) {
      const lineStrings =
        parsedPath.type === "MultiLineString" ? parsedPath.coordinates : [parsedPath.coordinates];
      for (const lineString of lineStrings) {
        const coordinates = lineString.map(
          ([lng, lat]) => [lat, lng] as [number, number]
        );
        if (coordinates.length < 2) continue;
        const line = L.polyline(coordinates, {
          color: ACCENT,
          weight: 4,
          opacity: 0.9,
        }).addTo(map);
        bounds.extend(line.getBounds());
      }
    }

    for (const destination of parsedDestinations) {
      const marker = L.circleMarker([destination.lat, destination.lng], {
        radius: 5,
        color: "#ffffff",
        weight: 1.5,
        fillColor: ACCENT,
        fillOpacity: 0.95,
      }).addTo(map);
      marker.bindPopup(
        detailLink(destination.name ?? "Unnamed destination", `/destinations/${encodeURIComponent(destination.id)}`)
      );
      bounds.extend([destination.lat, destination.lng]);
    }

    // Same re-measure shape as components/area-map.tsx's fitView — a
    // container sized with a percentage height can measure 0×0 on first
    // mount, which sends fitBounds to whole-world zoom.
    const fitView = () => {
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.12), { maxZoom: 15 });
      }
    };

    fitView();
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      fitView();
    });

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapInstance.current = null;
    };
  }, [routesJson, destinationsJson, pathJson]);

  return (
    <div
      ref={mapRef}
      className={`map-embed bg-fill ${className}`.trim()}
      role="region"
      aria-label="Route map"
    />
  );
}

function textNode(text: string): HTMLElement {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}

function detailLink(label: string, href: string): HTMLElement {
  const wrapper = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = label;
  title.style.fontWeight = "600";
  const link = document.createElement("a");
  link.href = href;
  link.textContent = "View details";
  link.style.display = "inline-block";
  link.style.marginTop = "4px";
  link.style.color = ACCENT;
  wrapper.append(title, link);
  return wrapper;
}

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
