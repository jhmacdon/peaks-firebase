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

const AREA_TEAL = "#0d9488";
const AREA_PALE_EDGE = "#ccfbf1";

export default function AreaMap({
  areaId,
  name,
  lat,
  lng,
  bbox,
  boundary,
  destinations = [],
  routes = [],
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
    });
    mapInstance.current = map;

    const topo = L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTRIBUTION,
      maxZoom: 17,
    }).addTo(map);
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

    const parsedBoundary = boundaryJson
      ? (JSON.parse(boundaryJson) as AreaBoundary)
      : null;
    const parsedDestinations = JSON.parse(
      destinationsJson
    ) as SerializedDestination[];
    const parsedRoutes = JSON.parse(routesJson) as SerializedRoute[];

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
      areaLayer.bindTooltip(textNode(name), { sticky: true });
      const boundaryBounds = areaLayer.getBounds();
      if (boundaryBounds.isValid()) {
        map.fitBounds(boundaryBounds.pad(0.08), { maxZoom: 13 });
      }
    } else {
      const fallbackBounds = L.latLngBounds(
        [minLat, minLng],
        [maxLat, maxLng]
      );
      if (fallbackBounds.isValid()) {
        map.fitBounds(fallbackBounds.pad(0.08), { maxZoom: 13 });
      }
    }

    for (const route of parsedRoutes) {
      if (!route.polyline6) continue;
      const coordinates = decodePolyline6(route.polyline6);
      if (coordinates.length < 2) continue;

      const line = L.polyline(coordinates, {
        color: "#2563eb",
        weight: 2,
        opacity: 0.62,
      }).addTo(map);
      line.bindTooltip(textNode(route.name ?? "Route"), { sticky: true });
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
      marker.bindPopup(
        detailLink(
          destination.name ?? "Unnamed destination",
          `/destinations/${encodeURIComponent(destination.id)}`
        )
      );
    }

    return () => {
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
  ]);

  return (
    <div
      ref={mapRef}
      className="h-80 w-full rounded-xl bg-gray-100 dark:bg-gray-900 sm:h-96"
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
