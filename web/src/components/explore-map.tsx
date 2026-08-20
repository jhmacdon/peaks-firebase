"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodePolyline6 } from "../lib/polyline";
import { formatDistanceMeters, formatElevationMeters } from "../lib/route-guide";
import {
  DEFAULT_MAP_VIEW,
  GEOLOCATED_ZOOM,
  ROUTE_MIN_ZOOM,
  destinationTypeWord,
  type MapViewState,
} from "../lib/map-view";

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
  /** Fly to a destination and open its popup — what a panel row click does.
   * Returns false when no marker is loaded for that id yet (a search hit
   * from outside the current viewport): the map still flies there, and the
   * caller can open the popup once the marker arrives. */
  openDestination: (id: string, lat: number, lng: number) => boolean;
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
  initialView: MapViewState | null;
  onReady: (handle: ExploreMapHandle) => void;
  onViewportChange: (viewport: MapViewport) => void;
  onSelectDestination: (destination: MapDestination) => void;
  onSelectRoute: (route: MapRoute) => void;
  onClearSelection: () => void;
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

// One map colour, the Peaks teal — same constant as destination-map.tsx and
// area-map.tsx (design-tokens.md, "Accent budget": a map selection is one of
// the places the accent is spent). Fixed hex rather than the token: these
// are painted into a Leaflet canvas layer, which never sees the page's CSS
// variables. Selection is carried by the pale edge and the extra weight
// rather than by a second hue, so the map never holds two competing
// accents.
const ACCENT = "#46ADBC";
const PALE_EDGE = "#CFEEF2";
const MARKER_EDGE = "#FFFFFF";

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

// Every string that reaches the map goes through a text node. Names,
// features and route titles are imported and admin-edited content, and the
// popups used to be HTML built by interpolation — one destination named
// with a tag would have been script on the page. `textContent` can't be
// markup, so the whole class of bug is gone rather than escaped-away.
function textNode(text: string): HTMLElement {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}

function popupLine(text: string, muted: boolean): HTMLElement {
  const line = document.createElement("div");
  line.textContent = text;
  line.style.marginTop = "2px";
  line.style.fontSize = "12px";
  if (muted) line.style.opacity = "0.72";
  return line;
}

function popupNode(title: string, detail: string, href: string, cta: string) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.fontWeight = "500";
  heading.style.fontSize = "14px";
  wrapper.append(heading);
  if (detail) wrapper.append(popupLine(detail, true));

  const link = document.createElement("a");
  link.href = href;
  link.textContent = cta;
  link.className = "map-popup-link";
  wrapper.append(link);
  return wrapper;
}

function destinationPopup(dest: MapDestination): HTMLElement {
  const detail = [
    destinationTypeWord(dest.features),
    dest.elevation != null ? formatElevationMeters(dest.elevation) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return popupNode(
    dest.name || "Unnamed destination",
    detail,
    `/destinations/${encodeURIComponent(dest.id)}`,
    "View guide"
  );
}

function routePopup(route: MapRoute): HTMLElement {
  const detail = `${formatDistanceMeters(route.distance)} · ${formatElevationMeters(
    route.gain
  )} gain`;
  return popupNode(
    route.name || "Unnamed route",
    detail,
    `/routes/${encodeURIComponent(route.id)}`,
    "View route"
  );
}

function hoverLabel(dest: MapDestination): HTMLElement {
  const elevation =
    dest.elevation != null ? ` · ${formatElevationMeters(dest.elevation)}` : "";
  return textNode(`${dest.name || "Unnamed"}${elevation}`);
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
        fillColor: ACCENT,
        color: selected ? PALE_EDGE : MARKER_EDGE,
        weight: selected ? 3 : 1.5,
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
        color: ACCENT,
        weight: selected ? 5 : hovered ? 4 : 2.5,
        opacity: selected || hovered ? 1 : 0.72,
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
        entry.marker.bindTooltip(textNode(entry.dest.name || ""), {
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
        fillColor: ACCENT,
        fillOpacity: 0.95,
        color: MARKER_EDGE,
        weight: 1.5,
      });

      marker.bindTooltip(hoverLabel(dest), {
        direction: "top",
        offset: [0, -6],
      });
      marker.bindPopup(() => destinationPopup(dest), { closeButton: true });

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

  // One place draws routes. It used to be two — a routes-change effect and a
  // near-copy inside the zoomend handler — which is how the two paths drifted
  // apart in the first place.
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
        color: ACCENT,
        weight: 2.5,
        opacity: 0.72,
      });

      line.bindTooltip(textNode(route.name || "Route"), { sticky: true });
      line.bindPopup(() => routePopup(route), { closeButton: true });

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
    const container = mapRef.current;
    if (!container || mapInstance.current) return;

    const view = initialViewRef.current;
    const map = L.map(container, {
      center: [
        view ? view.lat : DEFAULT_MAP_VIEW.lat,
        view ? view.lng : DEFAULT_MAP_VIEW.lng,
      ],
      zoom: view ? view.zoom : DEFAULT_MAP_VIEW.zoom,
      // The page draws its own control cluster (44px circles, top right).
      zoomControl: false,
      preferCanvas: true,
    });
    mapInstance.current = map;

    topoLayerRef.current = L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTR,
      maxZoom: 17,
      // OpenTopoMap serves no @2x tiles, so Leaflet's retina path fetches
      // the next zoom level at half tile size instead — contour lines and
      // place names stop looking soft on a high-density display.
      detectRetina: true,
    });
    satLayerRef.current = L.tileLayer(SAT_TILE, {
      attribution: SAT_ATTR,
      maxZoom: 18,
      detectRetina: true,
    });
    topoLayerRef.current.addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    const emitViewport = () => {
      // A container that hasn't been laid out yet measures 0×0, and the
      // bounds of a zero-size map are a single point — a viewport that
      // matches nothing in the database. Say nothing until there's a real
      // box to report; the observer below re-emits the moment there is.
      const size = map.getSize();
      if (size.x < 2 || size.y < 2) return;

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

    // A full-bleed container inside a freshly-mounted layout can measure
    // 0×0 the first time Leaflet reads it, and this map is never told to
    // move again on its own — so a one-off re-measure on the next frame
    // (what the detail embeds do) isn't enough here: it can still land
    // before the browser has laid the container out, leaving the map
    // convinced it is a point and the panel empty for as long as the
    // reader leaves it alone. Watching the box instead catches the real
    // size whenever it arrives, and every later resize with it.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      emitViewport();
    });
    observer.observe(container);

    // Only geolocate when the URL didn't pin a view — a shared link opens
    // where it was saved. A refusal, a timeout, or a browser without the
    // API all leave the map on DEFAULT_MAP_VIEW, which is already on screen.
    if (!view && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mapInstance.current) return;
          map.setView(
            [pos.coords.latitude, pos.coords.longitude],
            GEOLOCATED_ZOOM
          );
        },
        () => {
          // Stay on the fallback view.
        },
        { timeout: 5000, maximumAge: 600000 }
      );
    }

    const handle: ExploreMapHandle = {
      openDestination: (id, lat, lng) => {
        const entry = destMarkersRef.current.get(id);
        map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 0.8 });
        if (!entry) return false;
        entry.marker.openPopup();
        return true;
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
        // The line only exists above ROUTE_MIN_ZOOM; once the fly-to lands
        // there, zoomend has rebuilt it and the popup has something to hang
        // off. `once` so a later manual zoom doesn't reopen it.
        map.once("moveend", () => {
          routeLinesRef.current.get(id)?.openPopup();
        });
      },
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      zoomTo: (zoom) => map.flyTo(map.getCenter(), zoom, { duration: 0.5 }),
      showUserLocation: (lat, lng) => {
        userMarkerRef.current?.remove();
        const dot = document.createElement("div");
        dot.className = "map-user-dot";
        const icon = L.divIcon({
          className: "",
          html: dot,
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

    return () => observer.disconnect();
  }, [rebuildRouteLines, updatePeakLabels]);

  useEffect(() => {
    const stopObserving = initMap();
    const destMarkers = destMarkersRef.current;
    const routeLines = routeLinesRef.current;

    return () => {
      stopObserving?.();
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

  // `map-embed` styles the attribution down to a small muted line and puts
  // the popups on the page's tokens (globals.css); `bg-fill` is what shows
  // while tiles are in flight, in place of Leaflet's own grey.
  return <div ref={mapRef} className="map-embed h-full w-full bg-fill" />;
}
