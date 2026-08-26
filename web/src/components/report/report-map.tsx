"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodePolyline6 } from "../../lib/polyline";

export interface ReportMapDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  features?: string[];
  countryCode?: string | null;
}

export interface ReportMapRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
  hasOsmGeometry: boolean;
}

export interface ReportMapProps {
  destinations: ReportMapDestination[];
  routes: ReportMapRoute[];
  reportTitle: string;
  byline: string;
  excerpt?: string | null;
  className?: string;
}

type BaseLayer = "topo" | "aerial";

interface PreparedRoute extends ReportMapRoute {
  coordinates: [number, number][];
}

interface PreparedMapData {
  destinations: ReportMapDestination[];
  routes: PreparedRoute[];
  useUsgs: boolean;
  hasOsmRouteGeometry: boolean;
}

const ACCENT = "#46adbc";
const ROUTE_CASING = "#f7f6f2";
const HISTORY_KEY = "peaksReportMap";

const USGS_TOPO_TILE =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";
const USGS_AERIAL_TILE =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}";
const GLOBAL_TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const GLOBAL_AERIAL_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const USGS_CREDIT =
  "Map services and data available from U.S. Geological Survey, National Geospatial Program.";

const USGS_COVERAGE_ENVELOPES = [
  { minLat: 24, maxLat: 50, minLng: -125, maxLng: -66 },
  { minLat: 50, maxLat: 72, minLng: -180, maxLng: -129 },
  { minLat: 50, maxLat: 72, minLng: 170, maxLng: 180 },
  { minLat: 18, maxLat: 23, minLng: -161, maxLng: -154 },
  { minLat: 17, maxLat: 19, minLng: -68, maxLng: -64 },
  { minLat: 13, maxLat: 21, minLng: 143, maxLng: 146 },
  { minLat: -15, maxLat: -11, minLng: -172, maxLng: -168 },
] as const;

export default function ReportMap({
  destinations,
  routes,
  reportTitle,
  byline,
  excerpt,
  className =
    "h-[clamp(22rem,44vw,34rem)] min-h-[22rem] w-full rounded-media border border-border",
}: ReportMapProps) {
  const destinationsJson = JSON.stringify(destinations);
  const routesJson = JSON.stringify(routes);
  const data = useMemo(
    () => prepareMapData(destinationsJson, routesJson),
    [destinationsJson, routesJson]
  );
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("topo");
  const [exploreOpen, setExploreOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const exploreButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId();

  useEffect(() => {
    const syncWithUrl = () => {
      const shouldOpen = new URL(window.location.href).searchParams.get("map") === "1";
      setExploreOpen(shouldOpen);
    };

    syncWithUrl();
    window.addEventListener("popstate", syncWithUrl);
    return () => window.removeEventListener("popstate", syncWithUrl);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (exploreOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (!exploreOpen && dialog.open) {
      dialog.close();
      exploreButtonRef.current?.focus();
    }
  }, [exploreOpen]);

  useEffect(() => {
    if (!exploreOpen) return;

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [exploreOpen]);

  const openExplore = useCallback(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("map") !== "1") {
      url.searchParams.set("map", "1");
      const currentState = isRecord(window.history.state)
        ? window.history.state
        : {};
      window.history.pushState(
        { ...currentState, [HISTORY_KEY]: true },
        "",
        url
      );
    }
    setExploreOpen(true);
  }, []);

  const closeExplore = useCallback(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("map") !== "1") {
      setExploreOpen(false);
      return;
    }

    if (isRecord(window.history.state) && window.history.state[HISTORY_KEY]) {
      window.history.back();
      return;
    }

    url.searchParams.delete("map");
    window.history.replaceState(window.history.state, "", url);
    setExploreOpen(false);
  }, []);

  const destinationSummary = data.destinations
    .map((destination) => formatDestination(destination))
    .join(", ");
  const routeSummary = data.routes
    .map((route) => route.name || "Public route")
    .join(", ");

  return (
    <section
      className={`relative overflow-hidden bg-fill ${className}`.trim()}
      aria-label={`Map for ${reportTitle}`}
    >
      <MapCanvas
        data={data}
        baseLayer={baseLayer}
        expanded={false}
        ariaLabel={`Map showing ${destinationSummary || "the places in this report"}`}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex items-start justify-end gap-2 sm:inset-x-4 sm:top-4">
        <LayerSwitch value={baseLayer} onChange={setBaseLayer} />
        <button
          ref={exploreButtonRef}
          type="button"
          onClick={openExplore}
          className="pointer-events-auto inline-flex h-11 items-center rounded-ctl border border-border bg-page px-4 text-sm font-semibold text-ink shadow-float transition-colors hover:bg-fill"
        >
          Explore map
        </button>
      </div>

      <MapAttribution
        useUsgs={data.useUsgs}
        baseLayer={baseLayer}
        hasOsmRouteGeometry={data.hasOsmRouteGeometry}
        className="absolute bottom-8 right-2 z-[500] max-w-[calc(100%_-_1rem)] sm:bottom-auto sm:left-2 sm:right-auto sm:top-2 sm:max-w-[calc(100%_-_20rem)]"
      />

      <p className="sr-only">
        {destinationSummary
          ? `Tagged places: ${destinationSummary}.`
          : "No tagged places are available."}{" "}
        {routeSummary ? `Public routes: ${routeSummary}.` : "No public route is shown."}
      </p>

      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        onCancel={(event) => {
          event.preventDefault();
          closeExplore();
        }}
        onClose={() => {
          if (exploreOpen) closeExplore();
        }}
        className="m-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden border-0 bg-page p-0 backdrop:bg-black/45"
      >
        <div className="relative h-full w-full overflow-hidden bg-fill">
          {exploreOpen && (
            <MapCanvas
              data={data}
              baseLayer={baseLayer}
              expanded
              ariaLabel={`Expanded map showing ${destinationSummary || "the places in this report"}`}
            />
          )}

          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeExplore}
            className="absolute left-3 top-3 z-[500] inline-flex h-11 items-center rounded-ctl border border-border bg-page px-4 text-sm font-semibold text-ink shadow-float transition-colors hover:bg-fill sm:left-4 sm:top-4"
          >
            Close map
          </button>

          <div className="absolute right-3 top-3 z-[500] sm:right-4 sm:top-4">
            <LayerSwitch value={baseLayer} onChange={setBaseLayer} />
          </div>

          <aside className="absolute inset-x-3 bottom-3 z-[500] rounded-media border border-border bg-page p-4 shadow-float sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[25rem] sm:p-5">
            <p className="text-xs font-semibold text-accent-text">This report</p>
            <h2
              id={dialogTitleId}
              className="mt-1 font-display text-xl font-semibold leading-tight text-ink sm:text-2xl"
            >
              {reportTitle}
            </h2>
            <p className="mt-1 text-sm text-muted">{byline}</p>

            {excerpt && (
              <p className="mt-3 max-h-[4.5rem] overflow-hidden text-sm leading-6 text-ink-2">
                {excerpt}
              </p>
            )}

            {data.destinations.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Tagged places">
                {data.destinations.slice(0, 4).map((destination) => (
                  <a
                    key={destination.id}
                    href={`/destinations/${encodeURIComponent(destination.id)}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-border bg-page px-3 text-sm font-medium text-ink transition-colors hover:bg-fill"
                  >
                    {destination.name || "Unnamed destination"}
                  </a>
                ))}
                {data.destinations.length > 4 && (
                  <span className="inline-flex min-h-11 items-center px-2 text-sm text-muted">
                    +{data.destinations.length - 4} more
                  </span>
                )}
              </div>
            )}

            <p className="mt-3 border-t border-hairline pt-3 text-xs leading-5 text-muted">
              Shows tagged places and public routes. The author&apos;s private GPS
              track is not shared.
            </p>
            <MapAttribution
              useUsgs={data.useUsgs}
              baseLayer={baseLayer}
              hasOsmRouteGeometry={data.hasOsmRouteGeometry}
              className="mt-2"
            />
          </aside>
        </div>
      </dialog>
    </section>
  );
}

function MapCanvas({
  data,
  baseLayer,
  expanded,
  ariaLabel,
}: {
  data: PreparedMapData;
  baseLayer: BaseLayer;
  expanded: boolean;
  ariaLabel: string;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const tileLayerKeyRef = useRef("");
  const pendingTileLayerRef = useRef<L.TileLayer | null>(null);
  const baseLayerRef = useRef(baseLayer);
  const destinationsJson = JSON.stringify(data.destinations);
  const routesJson = JSON.stringify(data.routes);
  const useUsgs = data.useUsgs;

  useEffect(() => {
    baseLayerRef.current = baseLayer;
  }, [baseLayer]);

  useEffect(() => {
    if (!mapElementRef.current) return;

    mapRef.current?.remove();

    const mobileQuery = window.matchMedia("(max-width: 639px)");
    const inlineMobile = !expanded && mobileQuery.matches;
    const map = L.map(mapElementRef.current, {
      center: [39, -98],
      zoom: 4,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: expanded,
      dragging: !inlineMobile,
      touchZoom: expanded || !inlineMobile,
      doubleClickZoom: expanded || !inlineMobile,
      boxZoom: expanded,
      keyboard: true,
    });
    mapRef.current = map;
    tileLayerRef.current = createTileLayer(useUsgs, baseLayerRef.current).addTo(map);
    tileLayerKeyRef.current = tileKey(useUsgs, baseLayerRef.current);

    const parsedDestinations = JSON.parse(
      destinationsJson
    ) as ReportMapDestination[];
    const parsedRoutes = JSON.parse(routesJson) as PreparedRoute[];
    const bounds = L.latLngBounds([]);

    for (const route of parsedRoutes) {
      if (route.coordinates.length < 2) continue;

      L.polyline(route.coordinates, {
        color: ROUTE_CASING,
        weight: expanded ? 8 : 7,
        opacity: 0.96,
        interactive: false,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      const routeLine = L.polyline(route.coordinates, {
        color: ACCENT,
        weight: expanded ? 4 : 3.5,
        opacity: 0.98,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
      routeLine.bindPopup(routePopup(route));
      bounds.extend(routeLine.getBounds());
    }

    for (const destination of parsedDestinations) {
      const marker = L.circleMarker([destination.lat, destination.lng], {
        radius: expanded ? 7 : 6,
        color: "#ffffff",
        weight: 2.5,
        fillColor: ACCENT,
        fillOpacity: 1,
      }).addTo(map);
      marker.bindPopup(destinationPopup(destination));
      marker.bindTooltip(destination.name || "Unnamed destination", {
        direction: "top",
        offset: [0, -5],
      });
      bounds.extend([destination.lat, destination.lng]);
    }

    const fitView = () => {
      if (!bounds.isValid()) return;

      const mobile = mobileQuery.matches;
      const mapSize = map.getSize();
      const inlineHeaderLeft = Math.min(560, Math.round(mapSize.x * 0.44));
      const inlineHeaderBottom = Math.min(200, Math.round(mapSize.y * 0.34));
      map.fitBounds(bounds, {
        animate: false,
        maxZoom: expanded ? 15 : 14,
        paddingTopLeft: expanded
          ? mobile
            ? [32, 72]
            : [420, 72]
          : mobile
            ? [36, 52]
            : [inlineHeaderLeft, 48],
        paddingBottomRight: expanded
          ? mobile
            ? [32, 280]
            : [56, 56]
          : mobile
            ? [36, 52]
            : [48, inlineHeaderBottom],
      });
    };

    const updateInlineGestures = (event: MediaQueryListEvent) => {
      if (expanded) return;
      if (event.matches) {
        map.dragging.disable();
        map.touchZoom.disable();
        map.doubleClickZoom.disable();
      } else {
        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
      }
    };

    fitView();
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      fitView();
    });
    mobileQuery.addEventListener("change", updateInlineGestures);

    return () => {
      cancelAnimationFrame(frame);
      mobileQuery.removeEventListener("change", updateInlineGestures);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      tileLayerKeyRef.current = "";
      pendingTileLayerRef.current = null;
    };
  }, [destinationsJson, routesJson, expanded, useUsgs]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const nextKey = tileKey(useUsgs, baseLayer);
    pendingTileLayerRef.current?.removeFrom(map);
    pendingTileLayerRef.current = null;
    if (tileLayerKeyRef.current === nextKey) return;

    const previousLayer = tileLayerRef.current;
    const nextLayer = createTileLayer(useUsgs, baseLayer).addTo(map);
    pendingTileLayerRef.current = nextLayer;

    // Keep the current cartography underneath while the new layer arrives.
    // USGS imagery can take a few seconds at a glacier-scale zoom; exposing
    // the map's grey canvas during that wait makes a healthy service look
    // broken. New tiles cover the old ones as they load, then the old layer
    // leaves once Leaflet reports the visible set complete.
    const finishSwap = () => {
      if (pendingTileLayerRef.current !== nextLayer) return;
      previousLayer?.removeFrom(map);
      tileLayerRef.current = nextLayer;
      tileLayerKeyRef.current = nextKey;
      pendingTileLayerRef.current = null;
    };
    nextLayer.once("load", finishSwap);

    return () => {
      nextLayer.off("load", finishSwap);
    };
  }, [baseLayer, useUsgs]);

  return (
    <>
      <div
        ref={mapElementRef}
        className="map-embed absolute inset-0 h-full w-full bg-fill"
        role="region"
        aria-label={ariaLabel}
      />
      {expanded && (
        <div
          className="absolute right-3 top-[4.25rem] z-[500] flex flex-col overflow-hidden rounded-ctl border border-border bg-page shadow-float sm:right-4 sm:top-[4.5rem]"
          aria-label="Map zoom"
          role="group"
        >
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            className="h-11 w-11 border-b border-border bg-page text-2xl leading-none text-ink transition-colors hover:bg-fill"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            className="h-11 w-11 bg-page text-2xl leading-none text-ink transition-colors hover:bg-fill"
            aria-label="Zoom out"
          >
            −
          </button>
        </div>
      )}
    </>
  );
}

function LayerSwitch({
  value,
  onChange,
}: {
  value: BaseLayer;
  onChange: (value: BaseLayer) => void;
}) {
  return (
    <div
      className="pointer-events-auto inline-flex rounded-ctl border border-border bg-page p-0.5 shadow-float"
      role="group"
      aria-label="Map layer"
    >
      {(["topo", "aerial"] as const).map((layer) => {
        const selected = value === layer;
        return (
          <button
            key={layer}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(layer)}
            className={`h-11 min-w-[4.5rem] rounded-[5px] px-3 text-sm font-semibold transition-colors ${
              selected
                ? "bg-ink text-page"
                : "bg-page text-ink hover:bg-fill"
            }`}
          >
            {layer === "topo" ? "Topo" : "Aerial"}
          </button>
        );
      })}
    </div>
  );
}

function MapAttribution({
  useUsgs,
  baseLayer,
  hasOsmRouteGeometry,
  className,
}: {
  useUsgs: boolean;
  baseLayer: BaseLayer;
  hasOsmRouteGeometry: boolean;
  className?: string;
}) {
  let baseCredit: ReactNode;
  if (useUsgs) {
    baseCredit = (
      <>
        <a
          href="https://www.usgs.gov/programs/national-geospatial-program/national-map"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {USGS_CREDIT}
        </a>
      </>
    );
  } else if (baseLayer === "topo") {
    baseCredit = (
      <>
        Map data: ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          OpenStreetMap contributors
        </a>
        , SRTM · Map style: ©{" "}
        <a
          href="https://opentopomap.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          OpenTopoMap
        </a>{" "}
        (CC-BY-SA)
      </>
    );
  } else {
    baseCredit = (
      <>
        ©{" "}
        <a
          href="https://www.esri.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Esri
        </a>
        , Maxar, Earthstar Geographics
      </>
    );
  }

  return (
    <p
      className={`rounded-ctl bg-page/90 px-1.5 py-1 text-[10px] leading-4 text-muted ${className ?? ""}`.trim()}
    >
      {baseCredit}
      {hasOsmRouteGeometry ? (
        <>
          <span aria-hidden="true"> · </span>
          Route data ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            OpenStreetMap contributors
          </a>{" "}
          (<a
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            ODbL
          </a>)
        </>
      ) : null}
    </p>
  );
}

function createTileLayer(useUsgs: boolean, baseLayer: BaseLayer): L.TileLayer {
  if (useUsgs) {
    return L.tileLayer(baseLayer === "topo" ? USGS_TOPO_TILE : USGS_AERIAL_TILE, {
      maxNativeZoom: 16,
      maxZoom: 18,
      detectRetina: true,
      updateWhenIdle: true,
    });
  }

  if (baseLayer === "topo") {
    return L.tileLayer(GLOBAL_TOPO_TILE, {
      maxNativeZoom: 17,
      maxZoom: 18,
      updateWhenIdle: true,
    });
  }

  return L.tileLayer(GLOBAL_AERIAL_TILE, {
    maxNativeZoom: 18,
    maxZoom: 19,
    updateWhenIdle: true,
  });
}

function tileKey(useUsgs: boolean, baseLayer: BaseLayer): string {
  return `${useUsgs ? "usgs" : "global"}:${baseLayer}`;
}

function prepareMapData(
  destinationsJson: string,
  routesJson: string
): PreparedMapData {
  const destinations = (
    JSON.parse(destinationsJson) as ReportMapDestination[]
  ).filter(
    (destination) =>
      Number.isFinite(destination.lat) && Number.isFinite(destination.lng)
  );
  const routes = (JSON.parse(routesJson) as ReportMapRoute[]).flatMap(
    (route) => {
      if (!route.polyline6) return [];
      const coordinates = decodePolyline6(route.polyline6);
      return coordinates.length >= 2 ? [{ ...route, coordinates }] : [];
    }
  );
  const coordinates: [number, number][] = [
    ...destinations.map(
      (destination) => [destination.lat, destination.lng] as [number, number]
    ),
    ...routes.flatMap((route) => route.coordinates),
  ];

  return {
    destinations,
    routes,
    useUsgs:
      destinations.length > 0 &&
      destinations.every(
        (destination) => destination.countryCode?.toUpperCase() === "US"
      ) &&
      coordinates.every(([lat, lng]) => isWithinUsgsCoverage(lat, lng)),
    hasOsmRouteGeometry: routes.some((route) => route.hasOsmGeometry),
  };
}

function isWithinUsgsCoverage(lat: number, lng: number): boolean {
  return USGS_COVERAGE_ENVELOPES.some(
    (region) =>
      lat >= region.minLat &&
      lat <= region.maxLat &&
      lng >= region.minLng &&
      lng <= region.maxLng
  );
}

function formatDestination(destination: ReportMapDestination): string {
  const name = destination.name || "Unnamed destination";
  if (destination.elevation == null || !Number.isFinite(destination.elevation)) {
    return name;
  }
  return `${name}, ${Math.round(destination.elevation * 3.28084).toLocaleString("en-US")} feet`;
}

function destinationPopup(destination: ReportMapDestination): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.minWidth = "150px";

  const title = document.createElement("div");
  title.textContent = destination.name || "Unnamed destination";
  title.style.fontWeight = "600";
  wrapper.append(title);

  if (destination.elevation != null && Number.isFinite(destination.elevation)) {
    const elevation = document.createElement("div");
    elevation.textContent = `${Math.round(destination.elevation * 3.28084).toLocaleString("en-US")} ft`;
    elevation.style.marginTop = "2px";
    elevation.style.fontSize = "12px";
    elevation.style.color = "#64635e";
    wrapper.append(elevation);
  }

  const link = document.createElement("a");
  link.href = `/destinations/${encodeURIComponent(destination.id)}`;
  link.textContent = "View destination";
  link.className = "map-popup-link";
  wrapper.append(link);
  return wrapper;
}

function routePopup(route: ReportMapRoute): HTMLElement {
  const wrapper = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = route.name || "Public route";
  title.style.fontWeight = "600";
  wrapper.append(title);

  const link = document.createElement("a");
  link.href = `/routes/${encodeURIComponent(route.id)}`;
  link.textContent = "View route";
  link.className = "map-popup-link";
  wrapper.append(link);
  return wrapper;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
