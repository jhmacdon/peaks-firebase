"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  getDestinationsInViewport,
  getRoutesInViewport,
  searchDestinations,
  type SearchDestination,
  type ViewportRoute,
} from "../../../lib/actions/search";
import { Badge } from "../../../components/ui/badge";
import {
  formatDistanceMeters,
  formatElevationMeters,
} from "../../../lib/route-guide";
import {
  ROUTE_MIN_ZOOM,
  parseMapViewFromUrl,
  mapViewToQuery,
} from "../../../lib/map-view";
import type {
  ExploreMapHandle,
  MapDestination,
  MapRoute,
  MapViewport,
} from "../../../components/explore-map";

const ExploreMap = dynamic(() => import("../../../components/explore-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
      <span className="text-gray-500">Loading map…</span>
    </div>
  ),
});

type MapSelection =
  | { kind: "destination"; destination: MapDestination }
  | { kind: "route"; route: MapRoute }
  | null;

type ListTab = "peaks" | "routes";

function featureSummary(features: string[]): string | null {
  if (features.length === 0) return null;
  return features.slice(0, 2).join(", ");
}

export default function MapPage() {
  // Snapshot ?lat/lng/z once so a shared link opens exactly where it was saved.
  const [initialView] = useState(parseMapViewFromUrl);

  const [destinations, setDestinations] = useState<SearchDestination[]>([]);
  const [routes, setRoutes] = useState<ViewportRoute[]>([]);
  const [loadingViewport, setLoadingViewport] = useState(false);
  const [zoom, setZoom] = useState<number>(initialView?.zoom ?? 5);

  const [selection, setSelection] = useState<MapSelection>(null);
  const [hoveredDestId, setHoveredDestId] = useState<string | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);

  const [basemap, setBasemap] = useState<"topo" | "satellite">("topo");
  const [railOpen, setRailOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<ListTab>("peaks");

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchDestination[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  const mapHandleRef = useRef<ExploreMapHandle | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const centerRef = useRef<{ lat: number; lng: number } | null>(
    initialView ? { lat: initialView.lat, lng: initialView.lng } : null
  );

  const handleViewportChange = useCallback((viewport: MapViewport) => {
    setZoom(viewport.zoom);
    centerRef.current = { lat: viewport.centerLat, lng: viewport.centerLng };

    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(async () => {
      window.history.replaceState(
        null,
        "",
        `/map?${mapViewToQuery({
          lat: viewport.centerLat,
          lng: viewport.centerLng,
          zoom: viewport.zoom,
        })}`
      );

      const seq = ++viewportSeqRef.current;
      setLoadingViewport(true);
      try {
        const [dests, rts] = await Promise.all([
          getDestinationsInViewport(
            viewport.minLat,
            viewport.maxLat,
            viewport.minLng,
            viewport.maxLng
          ),
          getRoutesInViewport(
            viewport.minLat,
            viewport.maxLat,
            viewport.minLng,
            viewport.maxLng
          ),
        ]);
        if (seq === viewportSeqRef.current) {
          setDestinations(dests);
          setRoutes(rts);
        }
      } catch {
        // Keep whatever was previously loaded; the next pan retries.
      } finally {
        if (seq === viewportSeqRef.current) setLoadingViewport(false);
      }
    }, 300);
  }, []);

  // Debounced destination search, proximity-biased toward the map center.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        const center = centerRef.current;
        const results = await searchDestinations(
          q,
          center?.lat,
          center?.lng,
          8
        );
        if (seq === searchSeqRef.current) {
          setSearchResults(results.filter((r) => r.lat != null && r.lng != null));
        }
      } catch {
        // Leave prior results in place; typing again retries.
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mapDestinations = useMemo<MapDestination[]>(
    () =>
      destinations
        .filter((d) => d.lat != null && d.lng != null)
        .map((d) => ({
          id: d.id,
          name: d.name,
          elevation: d.elevation,
          lat: d.lat!,
          lng: d.lng!,
          features: d.features,
        })),
    [destinations]
  );

  const sortedDestinations = useMemo(
    () =>
      [...mapDestinations].sort((a, b) => {
        if (a.elevation == null && b.elevation == null) return 0;
        if (a.elevation == null) return 1;
        if (b.elevation == null) return -1;
        return b.elevation - a.elevation;
      }),
    [mapDestinations]
  );

  const mapRoutes = useMemo<MapRoute[]>(
    () =>
      routes.map((r) => ({
        id: r.id,
        name: r.name,
        polyline6: r.polyline6,
        distance: r.distance,
        gain: r.gain,
      })),
    [routes]
  );

  const sortedRoutes = useMemo(
    () =>
      [...mapRoutes].sort((a, b) => {
        if (a.distance == null && b.distance == null) return 0;
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      }),
    [mapRoutes]
  );

  const hasOsmRouteGeometry = useMemo(
    () => routes.some((r) => r.provenance?.contains_osm_geometry),
    [routes]
  );

  const selectedDestinationId =
    selection?.kind === "destination" ? selection.destination.id : null;
  const selectedRouteId = selection?.kind === "route" ? selection.route.id : null;

  const handleSelectDestination = useCallback((destination: MapDestination) => {
    setSelection({ kind: "destination", destination });
    setSheetOpen(false);
  }, []);

  const handleSelectRoute = useCallback((route: MapRoute) => {
    setSelection({ kind: "route", route });
    setSheetOpen(false);
  }, []);

  const handleClearSelection = useCallback(() => setSelection(null), []);

  const openDestination = useCallback(
    (destination: MapDestination) => {
      handleSelectDestination(destination);
      mapHandleRef.current?.focusDestination(destination.lat, destination.lng);
    },
    [handleSelectDestination]
  );

  const openRoute = useCallback(
    (route: MapRoute) => {
      handleSelectRoute(route);
      mapHandleRef.current?.focusRoute(route.id);
    },
    [handleSelectRoute]
  );

  const pickSearchResult = useCallback(
    (result: SearchDestination) => {
      const destination: MapDestination = {
        id: result.id,
        name: result.name,
        elevation: result.elevation,
        lat: result.lat!,
        lng: result.lng!,
        features: result.features,
      };
      setQuery("");
      setSearchResults([]);
      handleSelectDestination(destination);
      mapHandleRef.current?.focusDestination(destination.lat, destination.lng);
    },
    [handleSelectDestination]
  );

  const locateMe = useCallback(() => {
    if (!navigator.geolocation || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        mapHandleRef.current?.showUserLocation(
          pos.coords.latitude,
          pos.coords.longitude
        );
      },
      () => setLocating(false),
      { timeout: 8000, maximumAge: 60000 }
    );
  }, [locating]);

  const searchActive = query.trim().length >= 2;
  const routesHidden = zoom < ROUTE_MIN_ZOOM && sortedRoutes.length > 0;

  const listPanel = (
    <ListPanel
      tab={tab}
      onTabChange={setTab}
      loading={loadingViewport}
      destinations={sortedDestinations}
      routes={sortedRoutes}
      selectedDestinationId={selectedDestinationId}
      selectedRouteId={selectedRouteId}
      onPickDestination={openDestination}
      onPickRoute={openRoute}
      onHoverDestination={setHoveredDestId}
      onHoverRoute={setHoveredRouteId}
      routesHidden={routesHidden}
    />
  );

  const searchResultsPanel = (
    <div className="flex-1 overflow-y-auto">
      {searching ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500">
          Searching…
        </p>
      ) : searchResults.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500">
          No matches. Try a different name.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {searchResults.map((result) => (
            <li key={result.id}>
              <button
                onClick={() => pickSearchResult(result)}
                className="w-full px-4 py-2.5 text-left transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/30"
              >
                <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {result.name || "Unnamed"}
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-500">
                  {[
                    result.elevation != null
                      ? formatElevationMeters(result.elevation)
                      : null,
                    featureSummary(result.features),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const searchInput = (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
        <SearchIcon />
      </span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
        placeholder="Search peaks & places"
        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      />
      {query && (
        <button
          onClick={() => setQuery("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-5rem)] overflow-hidden bg-gray-100 md:h-[calc(100dvh-57px)] dark:bg-gray-900">
      <div className="absolute inset-0 z-0">
        <ExploreMap
          destinations={sortedDestinations}
          routes={mapRoutes}
          basemap={basemap}
          selectedDestinationId={selectedDestinationId}
          selectedRouteId={selectedRouteId}
          hoveredDestinationId={hoveredDestId}
          hoveredRouteId={hoveredRouteId}
          showRouteAttribution={hasOsmRouteGeometry}
          initialView={initialView}
          onReady={(handle) => {
            mapHandleRef.current = handle;
          }}
          onViewportChange={handleViewportChange}
          onSelectDestination={handleSelectDestination}
          onSelectRoute={handleSelectRoute}
          onClearSelection={handleClearSelection}
        />
      </div>

      {/* Desktop rail: search + in-view results */}
      {railOpen ? (
        <div className="absolute bottom-3 left-3 top-3 z-10 hidden w-[21.5rem] md:block">
          <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
            <div className="flex items-center gap-2 border-b border-gray-100 p-3 dark:border-gray-800">
              <div className="flex-1">{searchInput}</div>
              <button
                onClick={() => setRailOpen(false)}
                aria-label="Collapse panel"
                title="Collapse panel"
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <ChevronLeftIcon />
              </button>
            </div>
            {searchActive ? searchResultsPanel : listPanel}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setRailOpen(true)}
          aria-label="Open search and results"
          title="Search & results"
          className="absolute left-3 top-3 z-10 hidden items-center gap-2 rounded-lg border border-gray-200 bg-white/95 px-3 py-2.5 text-sm font-medium text-gray-700 shadow-lg backdrop-blur transition-colors hover:bg-white md:flex dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200 dark:hover:bg-gray-900"
        >
          <SearchIcon />
          Search & results
        </button>
      )}

      {/* Mobile search pill */}
      <div className="absolute left-3 right-[3.75rem] top-3 z-10 md:hidden">
        <div className="rounded-xl border border-gray-200 bg-white/95 p-1.5 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
          {searchInput}
        </div>
        {searchActive && (
          <div className="mt-2 flex max-h-[45dvh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
            {searchResultsPanel}
          </div>
        )}
      </div>

      {/* Map controls */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
        <div className="flex flex-col divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:divide-gray-700 dark:border-gray-800 dark:bg-gray-900">
          <ControlButton
            label="Zoom in"
            onClick={() => mapHandleRef.current?.zoomIn()}
          >
            <PlusIcon />
          </ControlButton>
          <ControlButton
            label="Zoom out"
            onClick={() => mapHandleRef.current?.zoomOut()}
          >
            <MinusIcon />
          </ControlButton>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <ControlButton
            label={
              basemap === "topo"
                ? "Switch to satellite"
                : "Switch to topo"
            }
            onClick={() =>
              setBasemap((prev) => (prev === "topo" ? "satellite" : "topo"))
            }
          >
            <LayersIcon />
          </ControlButton>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <ControlButton label="Show my location" onClick={locateMe}>
            <span className={locating ? "animate-pulse" : undefined}>
              <CrosshairIcon />
            </span>
          </ControlButton>
        </div>
      </div>

      {/* Routes-hidden hint */}
      {routesHidden && !selection && (
        <button
          onClick={() => mapHandleRef.current?.zoomTo(ROUTE_MIN_ZOOM)}
          className="absolute left-1/2 top-[3.75rem] z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-gray-200 bg-white/95 px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-lg backdrop-blur transition-colors hover:bg-white md:bottom-6 md:top-auto dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200 dark:hover:bg-gray-900"
        >
          {sortedRoutes.length}{" "}
          {sortedRoutes.length === 1 ? "route" : "routes"} here — zoom in to
          see {sortedRoutes.length === 1 ? "it" : "them"}
        </button>
      )}

      {/* Selection card */}
      {selection && (
        <div className="absolute inset-x-3 bottom-14 z-20 md:inset-x-auto md:bottom-6 md:right-3 md:w-80">
          <div className="relative rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <button
              onClick={handleClearSelection}
              aria-label="Close"
              className="absolute right-2.5 top-2.5 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <CloseIcon />
            </button>
            {selection.kind === "destination" ? (
              <>
                <div className="pr-8 text-base font-semibold leading-tight text-gray-950 dark:text-white">
                  {selection.destination.name || "Unnamed destination"}
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {selection.destination.elevation != null
                    ? formatElevationMeters(selection.destination.elevation)
                    : "Destination guide"}
                </div>
                {selection.destination.features.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {selection.destination.features
                      .slice(0, 3)
                      .map((feature, i) => (
                        <Badge key={feature} tone={i === 0 ? "emerald" : "gray"}>
                          {feature}
                        </Badge>
                      ))}
                  </div>
                )}
                <Link
                  href={`/destinations/${selection.destination.id}`}
                  className="mt-3.5 block rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  View guide
                </Link>
              </>
            ) : (
              <>
                <div className="pr-8 text-base font-semibold leading-tight text-gray-950 dark:text-white">
                  {selection.route.name || "Unnamed route"}
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {formatDistanceMeters(selection.route.distance)} ·{" "}
                  {formatElevationMeters(selection.route.gain)} gain
                </div>
                <Link
                  href={`/routes/${selection.route.id}`}
                  className="mt-3.5 block rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  View route
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 z-10 md:hidden">
        {sheetOpen ? (
          <div className="flex h-[55dvh] flex-col overflow-hidden rounded-t-2xl border-x border-t border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <button
              onClick={() => setSheetOpen(false)}
              className="flex w-full flex-col items-center gap-1 border-b border-gray-100 py-2 dark:border-gray-800"
              aria-label="Collapse list"
            >
              <span className="h-1 w-9 rounded-full bg-gray-300 dark:bg-gray-700" />
              <span className="text-xs font-medium text-gray-500">
                {inViewSummary(sortedDestinations.length, sortedRoutes.length)}
              </span>
            </button>
            {listPanel}
          </div>
        ) : (
          <div className="pointer-events-none flex justify-center pb-3">
            <button
              onClick={() => setSheetOpen(true)}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-4 py-2 text-sm font-medium text-gray-700 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200"
            >
              {loadingViewport ? (
                <Spinner />
              ) : (
                <ChevronUpIcon />
              )}
              {inViewSummary(sortedDestinations.length, sortedRoutes.length)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function inViewSummary(peakCount: number, routeCount: number): string {
  const peaks = `${peakCount.toLocaleString()} ${peakCount === 1 ? "peak" : "peaks"}`;
  const routes = `${routeCount.toLocaleString()} ${routeCount === 1 ? "route" : "routes"}`;
  return `${peaks} · ${routes} in view`;
}

function ListPanel({
  tab,
  onTabChange,
  loading,
  destinations,
  routes,
  selectedDestinationId,
  selectedRouteId,
  onPickDestination,
  onPickRoute,
  onHoverDestination,
  onHoverRoute,
  routesHidden,
}: {
  tab: ListTab;
  onTabChange: (tab: ListTab) => void;
  loading: boolean;
  destinations: MapDestination[];
  routes: MapRoute[];
  selectedDestinationId: string | null;
  selectedRouteId: string | null;
  onPickDestination: (destination: MapDestination) => void;
  onPickRoute: (route: MapRoute) => void;
  onHoverDestination: (id: string | null) => void;
  onHoverRoute: (id: string | null) => void;
  routesHidden: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-1 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <TabButton active={tab === "peaks"} onClick={() => onTabChange("peaks")}>
          Peaks · {destinations.length.toLocaleString()}
        </TabButton>
        <TabButton
          active={tab === "routes"}
          onClick={() => onTabChange("routes")}
        >
          Routes · {routes.length.toLocaleString()}
        </TabButton>
        {loading && (
          <span className="ml-auto pr-1 text-gray-400">
            <Spinner />
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {tab === "peaks" ? (
          destinations.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              No peaks in view. Pan or zoom out to load more.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {destinations.map((destination) => (
                <li key={destination.id}>
                  <button
                    onClick={() => onPickDestination(destination)}
                    onMouseEnter={() => onHoverDestination(destination.id)}
                    onMouseLeave={() => onHoverDestination(null)}
                    className={`w-full px-4 py-2.5 text-left transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/30 ${
                      destination.id === selectedDestinationId
                        ? "bg-blue-50 dark:bg-blue-950/40"
                        : ""
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {destination.name || "Unnamed"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      {[
                        destination.elevation != null
                          ? formatElevationMeters(destination.elevation)
                          : null,
                        featureSummary(destination.features),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Destination guide"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : routes.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            No published routes in view. Pan across route-dense terrain to load
            some.
          </p>
        ) : (
          <>
            {routesHidden && (
              <p className="border-b border-gray-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-800 dark:border-gray-800 dark:bg-amber-950/30 dark:text-amber-300">
                Route lines appear on the map once you zoom in. Tap a route to
                fly to it.
              </p>
            )}
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {routes.map((route) => (
                <li key={route.id}>
                  <button
                    onClick={() => onPickRoute(route)}
                    onMouseEnter={() => onHoverRoute(route.id)}
                    onMouseLeave={() => onHoverRoute(null)}
                    className={`w-full px-4 py-2.5 text-left transition-colors hover:bg-orange-50/60 dark:hover:bg-orange-950/20 ${
                      route.id === selectedRouteId
                        ? "bg-orange-50 dark:bg-orange-950/30"
                        : ""
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {route.name || "Unnamed route"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      {formatDistanceMeters(route.distance)} ·{" "}
                      {formatElevationMeters(route.gain)} gain
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
