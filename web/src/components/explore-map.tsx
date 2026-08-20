"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { destinationPopup, routePopup } from "./map-popups";

interface ExploreMapProps {
  destinations: Array<{
    id: string;
    name: string | null;
    elevation: number | null;
    lat: number;
    lng: number;
    features: string[];
  }>;
  routes: Array<{
    id: string;
    name: string | null;
    polyline6: string | null;
  }>;
  onViewportChange: (bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }) => void;
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

const TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTR =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

const SAT_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_ATTR =
  '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

export default function ExploreMap({
  destinations,
  routes,
  onViewportChange,
}: ExploreMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const onViewportChangeRef = useRef(onViewportChange);

  // Keep the callback ref up to date without re-running effects
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  // Initialize map once
  const initMap = useCallback(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [39, -98],
      zoom: 5,
      zoomControl: true,
    });
    mapInstance.current = map;

    const topoLayer = L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTR,
      maxZoom: 17,
    });

    const satLayer = L.tileLayer(SAT_TILE, {
      attribution: SAT_ATTR,
      maxZoom: 18,
    });

    topoLayer.addTo(map);

    L.control
      .layers(
        { Topo: topoLayer, Satellite: satLayer },
        {},
        { position: "topright" }
      )
      .addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    // Fire initial viewport
    const bounds = map.getBounds();
    onViewportChangeRef.current({
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
    });

    map.on("moveend", () => {
      const b = map.getBounds();
      onViewportChangeRef.current({
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLng: b.getWest(),
        maxLng: b.getEast(),
      });
    });

    // Try geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 10);
        },
        () => {
          // Stay at default US center
        },
        { timeout: 5000, maximumAge: 600000 }
      );
    }
  }, []);

  useEffect(() => {
    initMap();

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        markersLayerRef.current = null;
        routesLayerRef.current = null;
      }
    };
  }, [initMap]);

  // Update destination markers
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;

    layer.clearLayers();

    for (const dest of destinations) {
      if (dest.lat == null || dest.lng == null) continue;

      L.circleMarker([dest.lat, dest.lng], {
        radius: 5,
        fillColor: "#2563eb",
        fillOpacity: 0.9,
        color: "#ffffff",
        weight: 1.5,
      })
        .bindPopup(destinationPopup(dest))
        .addTo(layer);
    }
  }, [destinations]);

  // Draw route polylines; routes only show at zoom >= 11
  const renderRoutes = useCallback(() => {
    const layer = routesLayerRef.current;
    const map = mapInstance.current;
    if (!layer || !map) return;

    layer.clearLayers();

    if (map.getZoom() < 11) return;

    for (const route of routes) {
      if (!route.polyline6) continue;

      const coords = decodePolyline6(route.polyline6);
      if (coords.length < 2) continue;

      const polyline = L.polyline(coords, {
        color: "#f97316",
        weight: 2.5,
        opacity: 0.8,
      });

      if (route.name) {
        polyline.bindPopup(routePopup({ id: route.id, name: route.name }));
      }

      polyline.addTo(layer);
    }
  }, [routes]);

  // Update route polylines when data changes
  useEffect(() => {
    renderRoutes();
  }, [renderRoutes]);

  // Re-render routes on zoom change (show/hide based on zoom level)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    map.on("zoomend", renderRoutes);
    return () => {
      map.off("zoomend", renderRoutes);
    };
  }, [renderRoutes]);

  return (
    <div
      ref={mapRef}
      className="w-full z-0"
      style={{ height: "calc(100vh - 57px)" }}
    />
  );
}
