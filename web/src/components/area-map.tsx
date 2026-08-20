"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
  AreaBoundingBox,
  AreaBoundary,
} from "../lib/area-types";

interface AreaMapDestination {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

interface AreaMapRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
}

interface AreaMapProps {
  areaId: string;
  name: string;
  lat: number;
  lng: number;
  bbox: AreaBoundingBox;
  boundary: AreaBoundary | null;
  destinations?: AreaMapDestination[];
  routes?: AreaMapRoute[];
  /** Height/shape of the embed. The container owns the radius (mirrors
   * components/destination-map.tsx's contract), so a hero tile can round
   * itself without the map re-rounding its own corners underneath. */
  className?: string;
  interactive?: boolean;
}

interface SerializedDestination {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

interface SerializedRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
}

const TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTRIBUTION =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';
const SATELLITE_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

// Same teal as components/destination-map.tsx's ACCENT (design-tokens.md,
// "Accent budget" — a map selection is one of the places the accent is
// spent) on a narrow pale edge with a low-opacity fill, so the topo
// underneath stays readable. Fixed hex rather than the token: painted into
// a Leaflet canvas/SVG layer, which never sees the page's CSS variables.
const AREA_TEAL = "#46ADBC";
const AREA_PALE_EDGE = "#CFEEF2";

export default function AreaMap({
  areaId,
  name,
  lat,
  lng,
  bbox,
  boundary,
  destinations = [],
  routes = [],
  className = "h-80 w-full sm:h-96",
  interactive = true,
}: AreaMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  const boundaryJson = boundary ? JSON.stringify(boundary) : "";
  const destinationsJson = JSON.stringify(destinations);
  const routesJson = JSON.stringify(routes);
  const minLat = bbox.minLat;
  const maxLat = bbox.maxLat;
  const minLng = bbox.minLng;
  const maxLng = bbox.maxLng;

  useEffect(() => {
    if (!mapRef.current) return;

    mapInstance.current?.remove();

    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 9,
      scrollWheelZoom: false,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      zoomControl: interactive,
    });
    mapInstance.current = map;

    const topo = L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTRIBUTION,
      maxZoom: 17,
      detectRetina: true,
    }).addTo(map);

    if (interactive) {
      const satellite = L.tileLayer(SATELLITE_TILE, {
        attribution: SATELLITE_ATTRIBUTION,
        maxZoom: 18,
      });
      L.control
        .layers(
          { Topo: topo, Satellite: satellite },
          {},
          { position: "topright" }
        )
        .addTo(map);
    }

    const parsedBoundary = boundaryJson
      ? (JSON.parse(boundaryJson) as AreaBoundary)
      : null;
    const parsedDestinations = JSON.parse(
      destinationsJson
    ) as SerializedDestination[];
    const parsedRoutes = JSON.parse(routesJson) as SerializedRoute[];

    let boundaryBounds: L.LatLngBounds | null = null;
    if (parsedBoundary) {
      const feature = {
        type: "Feature",
        geometry: parsedBoundary,
        properties: {},
      } as GeoJSON.Feature<AreaBoundary>;

      L.geoJSON(feature, {
        style: {
          color: AREA_PALE_EDGE,
          weight: 5,
          opacity: 0.95,
          fillOpacity: 0,
        },
        interactive: false,
      }).addTo(map);

      const areaLayer = L.geoJSON(feature, {
        style: {
          color: AREA_TEAL,
          weight: 2,
          opacity: 1,
          fillColor: AREA_TEAL,
          fillOpacity: 0.12,
        },
      }).addTo(map);
      if (interactive) areaLayer.bindTooltip(textNode(name), { sticky: true });
      boundaryBounds = areaLayer.getBounds();
    }

    // Same shape as components/destination-map.tsx's fitView: computed once
    // and re-run on the next frame. A container sized with a percentage
    // height (this embed, inside a hero tile) can measure 0×0 the first
    // time Leaflet reads it, and fitBounds on a zero-size map lands on
    // whole-world zoom — which is exactly what a freshly-mounted area hero
    // used to show before this re-measure existed.
    const fitView = () => {
      if (boundaryBounds && boundaryBounds.isValid()) {
        map.fitBounds(boundaryBounds.pad(0.08), { maxZoom: 13 });
        return;
      }
      const fallbackBounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
      if (fallbackBounds.isValid()) {
        map.fitBounds(fallbackBounds.pad(0.08), { maxZoom: 13 });
      } else {
        map.setView([lat, lng], 9);
      }
    };

    fitView();
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      fitView();
    });

    for (const route of parsedRoutes) {
      if (!route.polyline6) continue;
      const coordinates = decodePolyline6(route.polyline6);
      if (coordinates.length < 2) continue;

      const line = L.polyline(coordinates, {
        color: "#2563eb",
        weight: 2,
        opacity: 0.62,
      }).addTo(map);
      if (interactive) line.bindTooltip(textNode(route.name ?? "Route"), { sticky: true });
    }

    for (const destination of parsedDestinations) {
      if (destination.lat == null || destination.lng == null) continue;
      const marker = L.circleMarker([destination.lat, destination.lng], {
        radius: 4,
        color: "#ffffff",
        weight: 1.5,
        fillColor: "#1d4ed8",
        fillOpacity: 0.95,
      }).addTo(map);
      if (interactive) {
        marker.bindPopup(
          detailLink(
            destination.name ?? "Unnamed destination",
            `/destinations/${encodeURIComponent(destination.id)}`
          )
        );
      }
    }

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapInstance.current = null;
    };
  }, [
    areaId,
    name,
    lat,
    lng,
    minLat,
    maxLat,
    minLng,
    maxLng,
    boundaryJson,
    destinationsJson,
    routesJson,
    interactive,
  ]);

  return (
    <div
      ref={mapRef}
      className={`map-embed bg-fill ${className}`.trim()}
      role="region"
      aria-label={`Map of ${name}`}
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
  link.style.color = "#2563eb";
  wrapper.append(title, link);
  return wrapper;
}

function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const decodedLatitude = decodeValue(encoded, index);
    if (!decodedLatitude) break;
    index = decodedLatitude.nextIndex;
    latitude += decodedLatitude.value;

    const decodedLongitude = decodeValue(encoded, index);
    if (!decodedLongitude) break;
    index = decodedLongitude.nextIndex;
    longitude += decodedLongitude.value;

    coordinates.push([latitude / 1e6, longitude / 1e6]);
  }

  return coordinates;
}

function decodeValue(
  encoded: string,
  startIndex: number
): { value: number; nextIndex: number } | null {
  let index = startIndex;
  let shift = 0;
  let result = 0;
  let byte = 0;

  do {
    if (index >= encoded.length || shift > 30) return null;
    byte = encoded.charCodeAt(index) - 63;
    if (byte < 0) return null;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index,
  };
}
