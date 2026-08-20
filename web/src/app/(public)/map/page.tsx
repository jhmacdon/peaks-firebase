"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  getDestinationsInViewport,
  getRoutesInViewport,
  searchDestinations,
  type SearchDestination,
  type ViewportRoute,
} from "../../../lib/actions/search";
import { ExploreChips } from "../../../components/explore/explore-chips";
import { ExploreControls } from "../../../components/explore/explore-controls";
import { ExplorePanel } from "../../../components/explore/explore-panel";
import {
  buildExploreResults,
  describeDestination,
  type ExploreResult,
} from "../../../lib/explore-results";
import {
  DEFAULT_MAP_VIEW,
  MAP_TYPES,
  ROUTE_MIN_ZOOM,
  VIEWPORT_DESTINATION_LIMIT,
  VIEWPORT_ROUTE_LIMIT,
  clampViewportBounds,
  destinationFeatureFilter,
  destinationTypesSelected,
  mapExploreHref,
  parseMapExploreUrl,
  routesSelected,
  toggleMapType,
  type MapTypeId,
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
    <div className="flex h-full w-full items-center justify-center bg-fill">
      <span className="text-sm text-muted">Loading map…</span>
    </div>
  ),
});

/** How long the map has to sit still before the viewport is read again. */
const VIEWPORT_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_LENGTH = 2;
const SEARCH_RESULT_LIMIT = 12;

/**
 * The explorer reads the URL, and the URL says where to look, what to show,
 * and what to search for — so nothing above it can be rendered on the
 * server. The Suspense boundary is what makes that legal: /map prerenders
 * as the shell below, and the explorer itself renders in the browser, where
 * the query string exists. Without it the server would render an empty
 * search and the browser a full one, and hydration would tear.
 */
export default function MapPage() {
  return (
    <div className="relative h-[calc(100dvh-var(--chrome-top-h)-var(--chrome-bottom-h))] overflow-hidden bg-fill md:h-[calc(100dvh-var(--chrome-h))]">
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm text-muted">Loading map…</span>
          </div>
        }
      >
        <MapExplorer />
      </Suspense>
    </div>
  );
}

function MapExplorer() {
  // Snapshot the URL once: a shared link opens exactly where it was saved,
  // and `?q=` handed over from Discover runs as a search. A snapshot, not a
  // subscription — from here on the map drives the URL, not the other way
  // round, and re-reading it on every pan would fight the reader.
  const searchParams = useSearchParams();
  const [initial] = useState(() => parseMapExploreUrl(searchParams.toString()));

  const [types, setTypes] = useState<MapTypeId[]>(initial.types);
  const [query, setQuery] = useState(initial.query);

  const [destinations, setDestinations] = useState<SearchDestination[]>([]);
  const [routes, setRoutes] = useState<ViewportRoute[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchResults, setSearchResults] = useState<SearchDestination[]>([]);
  const [searching, setSearching] = useState(false);

  const [centerLat, setCenterLat] = useState(
    initial.view?.lat ?? DEFAULT_MAP_VIEW.lat
  );
  const [centerLng, setCenterLng] = useState(
    initial.view?.lng ?? DEFAULT_MAP_VIEW.lng
  );
  const [zoom, setZoom] = useState(initial.view?.zoom ?? DEFAULT_MAP_VIEW.zoom);
  const [viewportKey, setViewportKey] = useState("");

  const [selectedDestinationId, setSelectedDestinationId] = useState<
    string | null
  >(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [hoveredDestinationId, setHoveredDestinationId] = useState<
    string | null
  >(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);

  const [basemap, setBasemap] = useState<"topo" | "satellite">("topo");
  const [locating, setLocating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const mapHandleRef = useRef<ExploreMapHandle | null>(null);
  const viewportRef = useRef<MapViewport | null>(null);
  const viewportSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  /** A destination picked before its marker existed (a search hit outside
   * the loaded viewport). The popup opens once the marker arrives. */
  const pendingPopupRef = useRef<string | null>(null);
  /** A result picked before the map finished loading — a `?q=` link can
   * resolve its search well before the Leaflet chunk lands. */
  const pendingFocusRef = useRef<ExploreResult | null>(null);
  /** A `?q=` handed over from Discover flies to its best match once — after
   * that the reader is driving. Only when the link pinned no view of its
   * own, which would have said where to look. */
  const followUrlQueryRef = useRef(
    initial.query.length >= MIN_SEARCH_LENGTH && initial.view === null
  );

  // Read during render (not in an effect) so the effects below, which run
  // after the render that changed them, always see the current values
  // without listing an array in their dependencies.
  const typesRef = useRef(types);
  typesRef.current = types;
  const centerRef = useRef({ lat: centerLat, lng: centerLng });
  centerRef.current = { lat: centerLat, lng: centerLng };

  const typesKey = types.join(",");
  const searchActive = query.trim().length >= MIN_SEARCH_LENGTH;

  const handleViewportChange = useCallback((viewport: MapViewport) => {
    viewportRef.current = viewport;
    setCenterLat(viewport.centerLat);
    setCenterLng(viewport.centerLng);
    setZoom(viewport.zoom);
    // Rounded to ~100m so a sub-pixel nudge doesn't re-query the database.
    setViewportKey(
      [
        viewport.minLat.toFixed(3),
        viewport.maxLat.toFixed(3),
        viewport.minLng.toFixed(3),
        viewport.maxLng.toFixed(3),
        viewport.zoom,
      ].join(",")
    );
  }, []);

  // Viewport reads. Debounced, sequence-guarded, and skipped entirely for a
  // layer nothing has asked for — routes below ROUTE_MIN_ZOOM cost seconds
  // on a continent-sized box and wouldn't be drawn anyway.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const timer = setTimeout(() => {
      const selectedTypes = typesRef.current;
      const bounds = clampViewportBounds(viewport);
      const center = {
        centerLat: viewport.centerLat,
        centerLng: viewport.centerLng,
      };
      const wantDestinations =
        destinationTypesSelected(selectedTypes).length > 0;
      const wantRoutes =
        routesSelected(selectedTypes) && viewport.zoom >= ROUTE_MIN_ZOOM;

      const seq = ++viewportSeqRef.current;
      setLoading(true);
      Promise.all([
        wantDestinations
          ? getDestinationsInViewport({
              ...bounds,
              ...center,
              features: destinationFeatureFilter(selectedTypes),
            })
          : Promise.resolve<SearchDestination[]>([]),
        wantRoutes
          ? getRoutesInViewport({ ...bounds, ...center })
          : Promise.resolve<ViewportRoute[]>([]),
      ])
        .then(([nextDestinations, nextRoutes]) => {
          if (seq !== viewportSeqRef.current) return;
          setDestinations(nextDestinations);
          setRoutes(nextRoutes);
        })
        .catch(() => {
          // Keep whatever was already loaded; the next pan retries.
        })
        .finally(() => {
          if (seq === viewportSeqRef.current) setLoading(false);
        });
    }, VIEWPORT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [viewportKey, typesKey]);

  // The URL is the view: pan, zoom, filter or search and the address bar
  // follows, so any view can be shared or bookmarked. replaceState, not a
  // router push — a pan is not a page in the reader's history. Nothing is
  // written until the map has reported a real viewport, so a link that
  // pinned no view never gets one invented for it.
  useEffect(() => {
    if (viewportKey === "") return;
    window.history.replaceState(
      null,
      "",
      mapExploreHref({
        view: { lat: centerLat, lng: centerLng, zoom },
        types: typesRef.current,
        query,
      })
    );
  }, [viewportKey, centerLat, centerLng, zoom, typesKey, query]);

  const focusResult = useCallback((result: ExploreResult) => {
    if (result.kind === "route") {
      setSelectedRouteId(result.id);
      setSelectedDestinationId(null);
    } else {
      setSelectedDestinationId(result.id);
      setSelectedRouteId(null);
    }

    const handle = mapHandleRef.current;
    if (!handle) {
      // The map is still loading — hold the pick and run it on ready.
      pendingFocusRef.current = result;
      return;
    }

    if (result.kind === "route") {
      handle.focusRoute(result.id);
      return;
    }
    // A false answer means no marker yet — a search hit from outside the
    // loaded viewport. The map is already flying there; the popup opens
    // when the marker arrives.
    const opened = handle.openDestination(result.id, result.lat, result.lng);
    pendingPopupRef.current = opened ? null : result.id;
  }, []);

  const handleMapReady = useCallback(
    (handle: ExploreMapHandle) => {
      mapHandleRef.current = handle;
      const pending = pendingFocusRef.current;
      if (!pending) return;
      pendingFocusRef.current = null;
      focusResult(pending);
    },
    [focusResult]
  );

  // Destination search, proximity-biased toward the map centre.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(() => {
      const center = centerRef.current;
      searchDestinations(q, center.lat, center.lng, SEARCH_RESULT_LIMIT)
        .then((results) => {
          if (seq !== searchSeqRef.current) return;
          const located = results.filter((r) => r.lat != null && r.lng != null);
          setSearchResults(located);
          if (followUrlQueryRef.current && located.length > 0) {
            followUrlQueryRef.current = false;
            const first = describeDestination(located[0], center.lat, center.lng);
            if (first) focusResult(first);
          }
        })
        .catch(() => {
          // Leave prior results in place; typing again retries.
        })
        .finally(() => {
          if (seq === searchSeqRef.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, focusResult]);

  const mapDestinations = useMemo<MapDestination[]>(
    () =>
      destinations
        .filter((d) => d.lat != null && d.lng != null)
        .map((d) => ({
          id: d.id,
          name: d.name,
          elevation: d.elevation,
          lat: d.lat as number,
          lng: d.lng as number,
          features: d.features,
        })),
    [destinations]
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

  const viewportResults = useMemo(
    () =>
      buildExploreResults({
        destinations: mapDestinations,
        routes: mapRoutes,
        centerLat,
        centerLng,
      }),
    [mapDestinations, mapRoutes, centerLat, centerLng]
  );

  const searchRows = useMemo(
    () =>
      searchResults
        .map((result) => describeDestination(result, centerLat, centerLng))
        .filter((result): result is ExploreResult => result !== null),
    [searchResults, centerLat, centerLng]
  );

  const results = searchActive ? searchRows : viewportResults;

  const hasOsmRouteGeometry = useMemo(
    () => routes.some((r) => r.provenance?.contains_osm_geometry),
    [routes]
  );

  // A cap is a fact about the query, not a label to hang on a filter. The
  // tabs used to read "Peaks · 200" whether the viewport held 200 peaks or
  // 20,000; now the count says what it is, and only claims "nearest" when
  // the read was actually cut short.
  const capped =
    destinations.length >= VIEWPORT_DESTINATION_LIMIT ||
    routes.length >= VIEWPORT_ROUTE_LIMIT;
  const countLine = searchActive
    ? searching
      ? "Searching…"
      : `${results.length} ${results.length === 1 ? "match" : "matches"}`
    : (loading || viewportKey === "") && results.length === 0
      ? // A read in flight — or a map that hasn't reported its first
        // viewport — is not the same fact as an empty viewport.
        "Loading results…"
      : capped
      ? `Showing the nearest ${results.length.toLocaleString()} results`
      : `${results.length.toLocaleString()} ${
          results.length === 1 ? "result" : "results"
        } in view`;

  const hint =
    !searchActive && routesSelected(types) && zoom < ROUTE_MIN_ZOOM
      ? "Routes appear once you zoom in."
      : null;

  // Re-open a popup for a destination picked before its marker existed.
  useEffect(() => {
    const pending = pendingPopupRef.current;
    if (!pending) return;
    const match = mapDestinations.find((d) => d.id === pending);
    if (!match) return;
    if (mapHandleRef.current?.openDestination(match.id, match.lat, match.lng)) {
      pendingPopupRef.current = null;
    }
  }, [mapDestinations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelectedDestinationId(null);
      setSelectedRouteId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSelectDestination = useCallback((destination: MapDestination) => {
    setSelectedDestinationId(destination.id);
    setSelectedRouteId(null);
  }, []);

  const handleSelectRoute = useCallback((route: MapRoute) => {
    setSelectedRouteId(route.id);
    setSelectedDestinationId(null);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedDestinationId(null);
    setSelectedRouteId(null);
  }, []);

  const handlePick = useCallback(
    (result: ExploreResult) => {
      setSheetOpen(false);
      focusResult(result);
    },
    [focusResult]
  );

  const handleHover = useCallback((result: ExploreResult | null) => {
    setHoveredDestinationId(
      result && result.kind === "destination" ? result.id : null
    );
    setHoveredRouteId(result && result.kind === "route" ? result.id : null);
  }, []);

  const handleToggleType = useCallback((id: MapTypeId) => {
    setTypes((current) => toggleMapType(current, id));
  }, []);

  const handleSelectAllTypes = useCallback(() => {
    setTypes(MAP_TYPES.map((type) => type.id));
  }, []);

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

  const panel = (withHeading: boolean) => (
    <ExplorePanel
      showHeading={withHeading}
      countLine={countLine}
      hint={hint}
      loading={loading}
      query={query}
      onQueryChange={setQuery}
      searching={searching}
      searchActive={searchActive}
      results={results}
      selectedId={selectedDestinationId ?? selectedRouteId}
      onPick={handlePick}
      onHover={handleHover}
    />
  );

  // Full-bleed: the map fills whatever the nav leaves — the wrapper in
  // MapPage sizes itself off the --chrome-* variables in globals.css rather
  // than hardcoded pixels, and `(public)/layout.tsx` withholds the footer
  // and the tab-bar gutter from this segment for the same reason.
  //
  // Every piece of chrome below is its own absolutely-positioned element
  // sized to its own content. Nothing spans the viewport: an overlay
  // wrapper with pointer-events across the whole page used to swallow drags
  // and clicks meant for the map.
  return (
    <>
      <div className="absolute inset-0 z-0">
        <ExploreMap
          destinations={mapDestinations}
          routes={mapRoutes}
          basemap={basemap}
          selectedDestinationId={selectedDestinationId}
          selectedRouteId={selectedRouteId}
          hoveredDestinationId={hoveredDestinationId}
          hoveredRouteId={hoveredRouteId}
          showRouteAttribution={hasOsmRouteGeometry}
          initialView={initial.view}
          onReady={handleMapReady}
          onViewportChange={handleViewportChange}
          onSelectDestination={handleSelectDestination}
          onSelectRoute={handleSelectRoute}
          onClearSelection={handleClearSelection}
        />
      </div>

      {/* Desktop: the floating panel, 400px against the left edge. */}
      <aside
        aria-label="Map results"
        className="absolute bottom-6 left-6 top-6 z-20 hidden w-[400px] flex-col overflow-hidden rounded-media border border-border bg-page shadow-float md:flex"
      >
        {panel(true)}
      </aside>

      {/* The panel's heading is the page's h1, and the panel is desktop-only.
          Below md the sheet's handle names the view instead, so the heading
          survives for a screen reader without printing twice. */}
      <h1 className="sr-only md:hidden">Explore the map</h1>

      {/* Filters float over the map: clear of the panel on desktop, across
          the top on mobile, where they scroll sideways. */}
      <ExploreChips
        types={types}
        onToggle={handleToggleType}
        onSelectAll={handleSelectAllTypes}
        className="absolute left-3 right-3 top-3 z-20 md:left-[28rem] md:right-24 md:top-6"
      />

      <ExploreControls
        onZoomIn={() => mapHandleRef.current?.zoomIn()}
        onZoomOut={() => mapHandleRef.current?.zoomOut()}
        onLocate={locateMe}
        locating={locating}
        basemap={basemap}
        onToggleBasemap={() =>
          setBasemap((current) => (current === "topo" ? "satellite" : "topo"))
        }
        className="absolute right-3 top-14 z-20 md:right-6 md:top-6"
      />

      {/* Mobile: the same panel as a bottom sheet. Collapsed it is a handle
          and the count; the wrapper takes no pointer events so the map
          underneath stays draggable right up to the sheet itself. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden">
        {sheetOpen ? (
          <div className="pointer-events-auto flex h-[60dvh] flex-col overflow-hidden rounded-t-media border-x border-t border-border bg-page shadow-float">
            {/* Open, the handle is only a handle — the panel under it
                carries the count, and printing it twice reads as a bug. */}
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-expanded="true"
              aria-label="Collapse results"
              className="flex w-full shrink-0 flex-col items-center py-3"
            >
              <span className="h-1 w-9 rounded-full bg-border" />
            </button>
            {panel(false)}
          </div>
        ) : (
          <div className="p-3">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-expanded="false"
              className="pointer-events-auto flex w-full flex-col items-center gap-1.5 rounded-media border border-border bg-page py-2.5 shadow-float"
            >
              <span className="h-1 w-9 rounded-full bg-border" />
              <span className="text-[13px] text-muted">{countLine}</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
