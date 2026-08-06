"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ROUTE_MIN_ZOOM } from "../lib/map-view";

export interface MapDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  features: string[];
}

export interface MapRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
}

export interface MapViewport {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
  zoom: number;
}

/** Imperative API handed to the page via onReady (next/dynamic doesn't forward refs). */
export interface ExploreMapHandle {
  focusDestination: (lat: number, lng: number) => void;
  focusRoute: (id: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;
  showUserLocation: (lat: number, lng: number) => void;
}

interface ExploreMapProps {
  destinations: MapDestination[];
  routes: MapRoute[];
  basemap: "topo" | "satellite";
  selectedDestinationId: string | null;
  selectedRouteId: string | null;
  hoveredDestinationId: string | null;
  hoveredRouteId: string | null;
  showRouteAttribution: boolean;
  initialView: { lat: number; lng: number; zoom: number } | null;
  onReady: (handle: ExploreMapHandle) => void;
  onViewportChange: (viewport: MapViewport) => void;
  onSelectDestination: (destination: MapDestination) => void;
  onSelectRoute: (route: MapRoute) => void;
  onClearSelection: () => void;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTR =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

const SAT_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_ATTR =
  '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

const ROUTE_DATA_ATTR =
  'Route data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>)';

const MARKER_FILL = "#2563eb";
const MARKER_SELECTED_FILL = "#f43f5e";
const ROUTE_COLOR = "#f97316";
const ROUTE_SELECTED_COLOR = "#ea580c";

// Peak-name labels stay on for the highest peaks once zoomed in far enough.
const PEAK_LABEL_ZOOM = 12;
const PEAK_LABEL_COUNT = 10;

/** Marker size tracks elevation so major peaks read at a glance. */
function markerRadius(elevation: number | null): number {
  if (elevation == null) return 4;
  if (elevation >= 4000) return 9;
  if (elevation >= 3000) return 8;
  if (elevation >= 2000) return 7;
  if (elevation >= 1000) return 5.5;
  return 4.5;
}

function hoverLabel(dest: MapDestination): string {
  const name = escapeHtml(dest.name || "Unnamed");
  const elevFt =
    dest.elevation != null
      ? ` &middot; ${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
      : "";
  return `${name}${elevFt}`;
}

interface DestMarkerEntry {
  marker: L.CircleMarker;
  baseRadius: number;
  dest: MapDestination;
  permanentLabel: boolean;
}

export default function ExploreMap({
  destinations,
  routes,
  basemap,
  selectedDestinationId,
  selectedRouteId,
  hoveredDestinationId,
  hoveredRouteId,
  showRouteAttribution,
  initialView,
  onReady,
  onViewportChange,
  onSelectDestination,
  onSelectRoute,
  onClearSelection,
}: ExploreMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const topoLayerRef = useRef<L.TileLayer | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const destMarkersRef = useRef<Map<string, DestMarkerEntry>>(new Map());
  const routeLinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const destinationsRef = useRef<MapDestination[]>([]);
  const routesRef = useRef<MapRoute[]>([]);

  const selectedDestIdRef = useRef<string | null>(selectedDestinationId);
  const hoveredDestIdRef = useRef<string | null>(hoveredDestinationId);
  const selectedRouteIdRef = useRef<string | null>(selectedRouteId);
  const hoveredRouteIdRef = useRef<string | null>(hoveredRouteId);
  const suppressMapClickRef = useRef(false);
  const initialViewRef = useRef(initialView);

  const onReadyRef = useRef(onReady);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectDestinationRef = useRef(onSelectDestination);
  const onSelectRouteRef = useRef(onSelectRoute);
  const onClearSelectionRef = useRef(onClearSelection);

  useEffect(() => {
    onReadyRef.current = onReady;
    onViewportChangeRef.current = onViewportChange;
    onSelectDestinationRef.current = onSelectDestination;
    onSelectRouteRef.current = onSelectRoute;
    onClearSelectionRef.current = onClearSelection;
  }, [onReady, onViewportChange, onSelectDestination, onSelectRoute, onClearSelection]);

  const applyDestinationEmphasis = useCallback(() => {
    for (const [id, entry] of destMarkersRef.current) {
      const selected = id === selectedDestIdRef.current;
      const hovered = id === hoveredDestIdRef.current;
      entry.marker.setStyle({
        fillColor: selected ? MARKER_SELECTED_FILL : MARKER_FILL,
        color: "#ffffff",
        weight: selected ? 2 : 1.5,
        fillOpacity: 0.95,
      });
      entry.marker.setRadius(
        entry.baseRadius + (selected ? 3 : hovered ? 2 : 0)
      );
      if (selected || hovered) entry.marker.bringToFront();
    }
  }, []);

  const applyRouteEmphasis = useCallback(() => {
    for (const [id, line] of routeLinesRef.current) {
      const selected = id === selectedRouteIdRef.current;
      const hovered = id === hoveredRouteIdRef.current;
      line.setStyle({
        color: selected ? ROUTE_SELECTED_COLOR : ROUTE_COLOR,
        weight: selected ? 5 : hovered ? 4 : 2.5,
        opacity: selected || hovered ? 1 : 0.75,
      });
      if (selected || hovered) line.bringToFront();
    }
  }, []);

  const updatePeakLabels = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;

    const labelIds = new Set<string>();
    if (map.getZoom() >= PEAK_LABEL_ZOOM) {
      [...destinationsRef.current]
        .filter((d) => d.elevation != null && d.name)
        .sort((a, b) => b.elevation! - a.elevation!)
        .slice(0, PEAK_LABEL_COUNT)
        .forEach((d) => labelIds.add(d.id));
    }

    for (const [id, entry] of destMarkersRef.current) {
      const wantLabel = labelIds.has(id);
      if (wantLabel === entry.permanentLabel) continue;
      entry.marker.unbindTooltip();
      if (wantLabel) {
        entry.marker.bindTooltip(escapeHtml(entry.dest.name || ""), {
          permanent: true,
          direction: "top",
          offset: [0, -8],
          className: "peak-label",
        });
      } else {
        entry.marker.bindTooltip(hoverLabel(entry.dest), {
          direction: "top",
          offset: [0, -6],
        });
      }
      entry.permanentLabel = wantLabel;
    }
  }, []);

  const rebuildDestinationMarkers = useCallback(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;

    layer.clearLayers();
    destMarkersRef.current.clear();

    for (const dest of destinationsRef.current) {
      const baseRadius = markerRadius(dest.elevation);
      const marker = L.circleMarker([dest.lat, dest.lng], {
        radius: baseRadius,
        fillColor: MARKER_FILL,
        fillOpacity: 0.95,
        color: "#ffffff",
        weight: 1.5,
      });

      marker.bindTooltip(hoverLabel(dest), {
        direction: "top",
        offset: [0, -6],
      });

      marker.on("click", () => {
        suppressMapClickRef.current = true;
        setTimeout(() => {
          suppressMapClickRef.current = false;
        }, 0);
        onSelectDestinationRef.current(dest);
      });
      marker.on("mouseover", () => {
        if (dest.id !== selectedDestIdRef.current) {
          marker.setRadius(baseRadius + 2);
        }
      });
      marker.on("mouseout", () => applyDestinationEmphasis());

      marker.addTo(layer);
      destMarkersRef.current.set(dest.id, {
        marker,
        baseRadius,
        dest,
        permanentLabel: false,
      });
    }

    updatePeakLabels();
    applyDestinationEmphasis();
  }, [applyDestinationEmphasis, updatePeakLabels]);

  const rebuildRouteLines = useCallback(() => {
    const layer = routesLayerRef.current;
    const map = mapInstance.current;
    if (!layer || !map) return;

    layer.clearLayers();
    routeLinesRef.current.clear();

    if (map.getZoom() < ROUTE_MIN_ZOOM) return;

    for (const route of routesRef.current) {
      if (!route.polyline6) continue;
      const coords = decodePolyline6(route.polyline6);
      if (coords.length < 2) continue;

      const line = L.polyline(coords, {
        color: ROUTE_COLOR,
        weight: 2.5,
        opacity: 0.75,
      });

      line.bindTooltip(escapeHtml(route.name || "Route"), { sticky: true });

      line.on("click", () => {
        suppressMapClickRef.current = true;
        setTimeout(() => {
          suppressMapClickRef.current = false;
        }, 0);
        onSelectRouteRef.current(route);
      });
      line.on("mouseover", () => {
        if (route.id !== selectedRouteIdRef.current) {
          line.setStyle({ weight: 4, opacity: 1 });
        }
      });
      line.on("mouseout", () => applyRouteEmphasis());

      line.addTo(layer);
      routeLinesRef.current.set(route.id, line);
    }

    applyRouteEmphasis();
  }, [applyRouteEmphasis]);

  const initMap = useCallback(() => {
    if (!mapRef.current || mapInstance.current) return;

    const view = initialViewRef.current;
    const map = L.map(mapRef.current, {
      center: view ? [view.lat, view.lng] : [39, -98],
      zoom: view ? view.zoom : 5,
      zoomControl: false,
      preferCanvas: true,
    });
    mapInstance.current = map;

    topoLayerRef.current = L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTR,
      maxZoom: 17,
    });
    satLayerRef.current = L.tileLayer(SAT_TILE, {
      attribution: SAT_ATTR,
      maxZoom: 18,
    });
    topoLayerRef.current.addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    const emitViewport = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      onViewportChangeRef.current({
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLng: b.getWest(),
        maxLng: b.getEast(),
        centerLat: c.lat,
        centerLng: c.lng,
        zoom: map.getZoom(),
      });
    };

    emitViewport();
    map.on("moveend", emitViewport);
    map.on("zoomend", () => {
      rebuildRouteLines();
      updatePeakLabels();
    });
    map.on("click", () => {
      if (suppressMapClickRef.current) return;
      onClearSelectionRef.current();
    });

    // Only geolocate when the URL didn't pin a view (shared links stay put).
    if (!view && navigator.geolocation) {
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

    const handle: ExploreMapHandle = {
      focusDestination: (lat, lng) => {
        map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 0.8 });
      },
      focusRoute: (id) => {
        const route = routesRef.current.find((r) => r.id === id);
        if (!route?.polyline6) return;
        const coords = decodePolyline6(route.polyline6);
        if (coords.length < 2) return;
        map.flyToBounds(L.latLngBounds(coords), {
          padding: [48, 48],
          maxZoom: 14,
          duration: 0.8,
        });
      },
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      zoomTo: (zoom) => map.flyTo(map.getCenter(), zoom, { duration: 0.5 }),
      showUserLocation: (lat, lng) => {
        userMarkerRef.current?.remove();
        const icon = L.divIcon({
          className: "",
          html: '<div style="width:14px;height:14px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,0.25),0 1px 4px rgba(0,0,0,0.4)"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        userMarkerRef.current = L.marker([lat, lng], {
          icon,
          interactive: false,
          zIndexOffset: 500,
        }).addTo(map);
        map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 1 });
      },
    };
    onReadyRef.current(handle);
  }, [rebuildRouteLines, updatePeakLabels]);

  useEffect(() => {
    initMap();
    const destMarkers = destMarkersRef.current;
    const routeLines = routeLinesRef.current;

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        topoLayerRef.current = null;
        satLayerRef.current = null;
        markersLayerRef.current = null;
        routesLayerRef.current = null;
        userMarkerRef.current = null;
        destMarkers.clear();
        routeLines.clear();
      }
    };
  }, [initMap]);

  useEffect(() => {
    destinationsRef.current = destinations;
    rebuildDestinationMarkers();
  }, [destinations, rebuildDestinationMarkers]);

  useEffect(() => {
    routesRef.current = routes;
    rebuildRouteLines();
  }, [routes, rebuildRouteLines]);

  useEffect(() => {
    selectedDestIdRef.current = selectedDestinationId;
    hoveredDestIdRef.current = hoveredDestinationId;
    selectedRouteIdRef.current = selectedRouteId;
    hoveredRouteIdRef.current = hoveredRouteId;
    applyDestinationEmphasis();
    applyRouteEmphasis();
  }, [
    selectedDestinationId,
    hoveredDestinationId,
    selectedRouteId,
    hoveredRouteId,
    applyDestinationEmphasis,
    applyRouteEmphasis,
  ]);

  useEffect(() => {
    const map = mapInstance.current;
    const topo = topoLayerRef.current;
    const sat = satLayerRef.current;
    if (!map || !topo || !sat) return;

    const target = basemap === "satellite" ? sat : topo;
    const other = basemap === "satellite" ? topo : sat;
    if (!map.hasLayer(target)) target.addTo(map);
    if (map.hasLayer(other)) map.removeLayer(other);
  }, [basemap]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map?.attributionControl) return;
    if (showRouteAttribution) {
      map.attributionControl.addAttribution(ROUTE_DATA_ATTR);
    } else {
      map.attributionControl.removeAttribution(ROUTE_DATA_ATTR);
    }
  }, [showRouteAttribution]);

  return <div ref={mapRef} className="h-full w-full" />;
}
