"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SearchBar from "../../../components/search-bar";
import DestinationCard from "../../../components/destination-card";
import RouteCard from "../../../components/route-card";
import ListCard from "../../../components/list-card";
import TripReportCard from "../../../components/trip-report-card";
import {
  searchDestinations,
  getNearbyDestinations,
  getPopularDestinations,
  searchRoutes,
  getPopularRoutes,
  getDiscoverStats,
  type DiscoverStats,
  type SearchDestination,
  type SearchRouteResult,
} from "../../../lib/actions/search";
import { getLists, type ListRow } from "../../../lib/actions/lists";
import {
  getRecentTripReports,
  type TripReport,
} from "../../../lib/actions/trip-reports";
import { useAuth } from "../../../lib/auth-context";
import {
  describeRouteShape,
  formatDistanceMeters,
  formatElevationMeters,
} from "../../../lib/route-guide";

const SEARCH_SCOPES = ["all", "destinations", "routes", "lists"] as const;

type SearchScope = (typeof SEARCH_SCOPES)[number];

function isSearchScope(value: string | null): value is SearchScope {
  return Boolean(value && SEARCH_SCOPES.includes(value as SearchScope));
}

function formatFeet(elevation: number | null): string | null {
  if (elevation == null) return null;
  return `${Math.round(elevation * 3.28084).toLocaleString("en-US")} ft`;
}

function formatDistanceAway(distanceMeters: number | null | undefined): string | null {
  if (distanceMeters == null) return null;
  if (distanceMeters < 1609.34) return `${Math.round(distanceMeters)} m away`;
  return `${(distanceMeters / 1609.34).toFixed(1)} mi away`;
}

function labelize(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DiscoverContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const searchScope = isSearchScope(searchParams.get("type"))
    ? (searchParams.get("type") as SearchScope)
    : "all";
  const { user } = useAuth();

  const [nearby, setNearby] = useState<SearchDestination[]>([]);
  const [popularDestinations, setPopularDestinations] = useState<SearchDestination[]>([]);
  const [popularRoutes, setPopularRoutes] = useState<SearchRouteResult[]>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [recentReports, setRecentReports] = useState<TripReport[]>([]);
  const [stats, setStats] = useState<DiscoverStats>({
    destinationCount: 0,
    routeCount: 0,
    listCount: 0,
  });
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "pending" | "granted" | "denied"
  >(typeof window !== "undefined" && navigator.geolocation ? "pending" : "denied");
  const [sectionsLoaded, setSectionsLoaded] = useState(false);
  const hasLocation = userLat !== null && userLng !== null;

  const [searchedQuery, setSearchedQuery] = useState("");
  const [destinationResults, setDestinationResults] = useState<SearchDestination[]>([]);
  const [routeResults, setRouteResults] = useState<SearchRouteResult[]>([]);
  const [listResults, setListResults] = useState<ListRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Request geolocation once on mount
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
        setLocationStatus("granted");
      },
      () => {
        setLocationStatus("denied");
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  }, []);

  // Load search results when query changes
  useEffect(() => {
    if (!query) {
      setSearchedQuery("");
      setDestinationResults([]);
      setRouteResults([]);
      setListResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    async function search() {
      setSearchLoading(true);
      try {
        const [destinationsRes, routesRes, listsRes] = await Promise.all([
          searchDestinations(query, userLat ?? undefined, userLng ?? undefined, 9),
          searchRoutes(query, 6),
          getLists(query, 6, 0),
        ]);
        if (!cancelled) {
          setSearchedQuery(query);
          setDestinationResults(destinationsRes);
          setRouteResults(routesRes);
          setListResults(listsRes.lists);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }
    search();
    return () => {
      cancelled = true;
    };
  }, [query, userLat, userLng]);

  const isSearching = query
    ? searchLoading || searchedQuery !== query
    : false;

  // Load hero data even on direct search URLs so the search surface stays useful.
  useEffect(() => {
    let cancelled = false;
    async function loadHeroData() {
      try {
        const [popularDestinationResult, statsResult] = await Promise.all([
          getPopularDestinations(12),
          getDiscoverStats(),
        ]);
        if (!cancelled) {
          setPopularDestinations(popularDestinationResult);
          setStats(statsResult);
        }
      } catch {
        // Keep the hero usable even if supporting data fails to load.
      }
    }
    loadHeroData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load discover sections when no query.
  useEffect(() => {
    if (query) return;
    let cancelled = false;
    async function loadSections() {
      try {
        const [popularRouteResult, listsResult, reportsResult] = await Promise.all([
          getPopularRoutes(6),
          getLists(undefined, 6, 0),
          getRecentTripReports(4),
        ]);
        if (!cancelled) {
          setPopularRoutes(popularRouteResult);
          setLists(listsResult.lists);
          setRecentReports(reportsResult);
          setSectionsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setSectionsLoaded(true);
        }
      }
    }
    loadSections();
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Load nearby when location becomes available
  useEffect(() => {
    if (query || !hasLocation) return;
    let cancelled = false;
    async function loadNearby() {
      try {
        const near = await getNearbyDestinations(
          userLat!,
          userLng!,
          50000,
          12
        );
        if (!cancelled) {
          setNearby(near);
        }
      } catch {
        if (!cancelled) {
          setNearby([]);
        }
      }
    }
    loadNearby();
    return () => {
      cancelled = true;
    };
  }, [query, hasLocation, userLat, userLng]);

  const loading = !query && !sectionsLoaded;
  const totalSearchResults =
    destinationResults.length + routeResults.length + listResults.length;
  const visibleDestinationResults =
    searchScope === "all" || searchScope === "destinations"
      ? destinationResults
      : [];
  const visibleRouteResults =
    searchScope === "all" || searchScope === "routes" ? routeResults : [];
  const visibleListResults =
    searchScope === "all" || searchScope === "lists" ? listResults : [];
  const visibleSearchResults =
    visibleDestinationResults.length +
    visibleRouteResults.length +
    visibleListResults.length;
  const popularSearches = popularDestinations
    .map((destination) => destination.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 6);

  const topResults = [
    ...destinationResults.slice(0, 3).map((destination) => ({
      id: `destination-${destination.id}`,
      href: `/destinations/${destination.id}`,
      title: destination.name || "Unnamed destination",
      typeLabel: "Peak or place",
      summary: [
        labelize(destination.type),
        formatFeet(destination.elevation),
        formatDistanceAway(destination.distance_m) ?? labelize(destination.features[0]),
      ]
        .filter((item): item is string => Boolean(item))
        .join(" · "),
      rank: 300 + (destination.score ?? 0),
    })),
    ...routeResults.slice(0, 3).map((route) => ({
      id: `route-${route.id}`,
      href: `/routes/${route.id}`,
      title: route.name || "Unnamed route",
      typeLabel: "Route guide",
      summary: [
        describeRouteShape(route.shape),
        formatDistanceMeters(route.distance),
        route.gain != null ? `${formatElevationMeters(route.gain)} gain` : null,
      ]
        .filter((item): item is string => Boolean(item))
        .join(" · "),
      rank:
        200 +
        (route.name?.toLowerCase().startsWith(query.toLowerCase()) ? 20 : 0) +
        route.session_count,
    })),
    ...listResults.slice(0, 2).map((list) => ({
      id: `list-${list.id}`,
      href: `/lists/${list.id}`,
      title: list.name,
      typeLabel: "Curated list",
      summary: `${list.destination_count} destination${list.destination_count === 1 ? "" : "s"}`,
      rank: 100 + list.destination_count,
    })),
  ]
    .sort((left, right) => right.rank - left.rank)
    .slice(0, 4);

  const searchScopeOptions: {
    id: SearchScope;
    label: string;
    count: number;
  }[] = [
    { id: "all", label: "All results", count: totalSearchResults },
    {
      id: "destinations",
      label: "Peaks & places",
      count: destinationResults.length,
    },
    { id: "routes", label: "Routes", count: routeResults.length },
    { id: "lists", label: "Lists", count: listResults.length },
  ];

  function buildDiscoverHref(overrides?: {
    nextQuery?: string | null;
    nextScope?: SearchScope | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());

    if (overrides?.nextQuery !== undefined) {
      if (overrides.nextQuery && overrides.nextQuery.trim()) {
        params.set("q", overrides.nextQuery.trim());
      } else {
        params.delete("q");
      }
    }

    if (overrides?.nextScope !== undefined) {
      if (overrides.nextScope && overrides.nextScope !== "all") {
        params.set("type", overrides.nextScope);
      } else {
        params.delete("type");
      }
    }

    const nextQueryString = params.toString();
    return nextQueryString ? `/discover?${nextQueryString}` : "/discover";
  }

  const mapHref = query ? `/map?q=${encodeURIComponent(query)}` : "/map";

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <section className="overflow-hidden rounded-[32px] border border-stone-200 bg-[linear-gradient(180deg,rgba(250,248,242,0.92),rgba(255,255,255,1))] shadow-sm dark:border-gray-800 dark:bg-[linear-gradient(180deg,rgba(24,24,20,0.96),rgba(12,12,12,1))]">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:p-10">
          <div>
            <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/60 dark:text-emerald-300">
              Explore and plan
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight text-stone-950 dark:text-white sm:text-4xl">
              Search like a trail planner, not a landing page.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600 dark:text-gray-300">
              Find peaks, trailheads, shelters, route guides, and curated lists.
              Start from a name, jump straight to the map, or browse what people
              are actually climbing right now.
            </p>
            <div className="mt-6 max-w-3xl">
              <SearchBar placeholder="Search peaks, trailheads, routes, and lists" />
            </div>

            {query ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {searchScopeOptions.map((scope) => (
                  <Link
                    key={scope.id}
                    href={buildDiscoverHref({ nextScope: scope.id })}
                    className={`rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                      searchScope === scope.id
                        ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950"
                        : "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:text-stone-950 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-500"
                    }`}
                  >
                    {scope.label} <span className="ml-1 opacity-70">{scope.count}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="#nearby"
                  className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:text-stone-950 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  Nearby objectives
                </Link>
                <Link
                  href="#featured-routes"
                  className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:text-stone-950 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  Featured routes
                </Link>
                <Link
                  href="/lists"
                  className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:text-stone-950 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  Curated lists
                </Link>
                <Link
                  href="#recent-reports"
                  className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:text-stone-950 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  Recent field notes
                </Link>
              </div>
            )}

            {popularSearches.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                  Popular searches
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {popularSearches.map((term) => (
                    <Link
                      key={term}
                      href={buildDiscoverHref({ nextQuery: term, nextScope: null })}
                      className="rounded-full bg-stone-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200"
                    >
                      {term}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={mapHref}
                className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
              >
                Open map explorer
              </Link>
              <Link
                href={user ? "/plans/new" : "/register"}
                className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-900 transition-colors hover:border-stone-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-gray-500"
              >
                {user ? "Build a trip plan" : "Create an account"}
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            <aside className="rounded-[28px] border border-stone-200 bg-white/90 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/70">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                Browse the catalog
              </div>
              <div className="mt-4 space-y-4">
                <CatalogStat
                  label="Destination guides"
                  value={stats.destinationCount.toLocaleString("en-US")}
                  detail="Peaks, trailheads, shelters, and mapped objectives"
                />
                <CatalogStat
                  label="Published routes"
                  value={stats.routeCount.toLocaleString("en-US")}
                  detail="Distance, gain, shape, and map-ready route pages"
                />
                <CatalogStat
                  label="Curated lists"
                  value={stats.listCount.toLocaleString("en-US")}
                  detail="Peak-bagging collections and planning checklists"
                />
              </div>
            </aside>

            <aside className="rounded-[28px] border border-stone-200 bg-stone-950 p-5 text-stone-50 shadow-sm dark:border-gray-800 dark:bg-stone-900">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-300">
                Better starting points
              </div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-stone-200">
                <p>Use search when you already know the objective.</p>
                <p>Use the map when you want nearby options and terrain context.</p>
                <p>Use lists when you are planning a progression or peak-bagging goal.</p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Search Results */}
      {query ? (
        <div className="mt-10 space-y-8">
          <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                  Search results
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">
                  {isSearching ? "Searching..." : `Results for "${query}"`}
                </h2>
                <p className="mt-2 text-sm text-stone-500 dark:text-gray-400">
                  {isSearching
                    ? "Looking across destination guides, route pages, and curated lists."
                    : `${visibleSearchResults} visible result${visibleSearchResults === 1 ? "" : "s"}${searchScope === "all" ? ` across ${totalSearchResults} total matches.` : ` in ${searchScopeOptions.find((scope) => scope.id === searchScope)?.label.toLowerCase()}.`}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={mapHref}
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                >
                  Open on the map
                </Link>
                <Link
                  href={buildDiscoverHref({ nextQuery: null, nextScope: null })}
                  className="text-sm font-medium text-stone-600 hover:text-stone-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Clear search
                </Link>
              </div>
            </div>
          </div>

          {!isSearching && searchScope === "all" && topResults.length > 0 && (
            <SearchSection
              title="Best matches"
              count={topResults.length}
              description="A quick mixed view so you do not have to guess which section to open first."
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {topResults.map((result) => (
                  <Link
                    key={result.id}
                    href={result.href}
                    className="group rounded-[24px] border border-stone-200 bg-stone-50 px-5 py-4 transition-colors hover:border-stone-300 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                      {result.typeLabel}
                    </div>
                    <div className="mt-2 text-lg font-semibold tracking-tight text-stone-950 transition-colors group-hover:text-emerald-800 dark:text-white dark:group-hover:text-emerald-300">
                      {result.title}
                    </div>
                    <p className="mt-2 text-sm text-stone-600 dark:text-gray-300">
                      {result.summary}
                    </p>
                  </Link>
                ))}
              </div>
            </SearchSection>
          )}

          {!isSearching && visibleSearchResults === 0 && (
            <div className="rounded-[28px] border border-dashed border-stone-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
              <div className="text-lg font-semibold text-stone-950 dark:text-white">
                No matches for &ldquo;{query}&rdquo; in this view.
              </div>
              <p className="mt-2 text-sm text-stone-500 dark:text-gray-400">
                Try a broader search, switch result types, or start from one of the popular objectives below.
              </p>
              {popularSearches.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {popularSearches.map((term) => (
                    <Link
                      key={term}
                      href={buildDiscoverHref({ nextQuery: term, nextScope: null })}
                      className="rounded-full border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:text-stone-950 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
                    >
                      {term}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {visibleDestinationResults.length > 0 && (
            <SearchSection
              title="Destinations"
              count={visibleDestinationResults.length}
              description="Peaks, shelters, trailheads, and other mapped objectives."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleDestinationResults.map((dest) => (
                  <DestinationCard
                    key={dest.id}
                    id={dest.id}
                    name={dest.name}
                    elevation={dest.elevation}
                    features={dest.features}
                    distance_m={dest.distance_m}
                  />
                ))}
              </div>
            </SearchSection>
          )}

          {visibleRouteResults.length > 0 && (
            <SearchSection
              title="Routes"
              count={visibleRouteResults.length}
              description="Published route guides with maps, elevation, and segment breakdowns."
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {visibleRouteResults.map((route) => (
                  <RouteCard key={route.id} route={route} />
                ))}
              </div>
            </SearchSection>
          )}

          {visibleListResults.length > 0 && (
            <SearchSection
              title="Lists"
              count={visibleListResults.length}
              description="Curated collections you can browse and track."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleListResults.map((list) => (
                  <ListCard key={list.id} list={list} />
                ))}
              </div>
            </SearchSection>
          )}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : (
        <div className="mt-10 space-y-12">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <QuickBrowseCard
              href={locationStatus === "denied" ? "/map" : "#nearby"}
              eyebrow="Closest start"
              title="Nearby objectives"
              detail={
                hasLocation
                  ? nearby.length > 0
                    ? `${nearby.length} nearby options loaded from your current location`
                    : "We have your location, but nothing close is loaded yet"
                  : locationStatus === "denied"
                    ? "Location is off, so the map is the best way to browse nearby terrain"
                    : "Use your location for quick-hit peaks, trailheads, and shelters"
              }
            />
            <QuickBrowseCard
              href="/map"
              eyebrow="Map-first"
              title="Scout terrain"
              detail="Browse objectives spatially when you care more about area and terrain than exact names."
            />
            <QuickBrowseCard
              href="#featured-routes"
              eyebrow="Guides"
              title="Published routes"
              detail={`${popularRoutes.length} public route guides with shape, distance, and gain.`}
            />
            <QuickBrowseCard
              href="#recent-reports"
              eyebrow="Conditions"
              title="Recent field notes"
              detail={`${recentReports.length} recent trip reports from the community.`}
            />
          </section>

          {/* Nearby Section */}
          {locationStatus !== "denied" && (
            <section id="nearby">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                    Closest to you
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Nearby</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Quick-hit objectives near your current location.
                  </p>
                </div>
                <Link
                  href="/map"
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                >
                  View on map
                </Link>
              </div>
              {!hasLocation ? (
                <div className="rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  Requesting your location...
                </div>
              ) : nearby.length === 0 ? (
                <div className="rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  No destinations found nearby
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {nearby.map((dest) => (
                    <DestinationCard
                      key={dest.id}
                      id={dest.id}
                      name={dest.name}
                      elevation={dest.elevation}
                      features={dest.features}
                      distance_m={dest.distance_m}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Popular Section */}
          <section id="popular-destinations">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                  Most climbed
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  Popular destinations
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  The most recorded mountain and destination guides in Peaks.
                </p>
              </div>
            </div>
            {popularDestinations.length === 0 ? (
              <div className="rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                No popular destinations yet
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {popularDestinations.map((dest) => (
                  <DestinationCard
                    key={dest.id}
                    id={dest.id}
                    name={dest.name}
                    elevation={dest.elevation}
                    features={dest.features}
                  />
                ))}
              </div>
            )}
          </section>

          <section id="featured-routes">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                  Route guides
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  Featured routes
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Public route pages with distance, gain, maps, and segment detail.
                </p>
              </div>
            </div>
            {popularRoutes.length === 0 ? (
              <div className="rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                No published routes yet
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {popularRoutes.map((route) => (
                  <RouteCard key={route.id} route={route} />
                ))}
              </div>
            )}
          </section>

          {/* Browse Lists Section */}
          <section id="browse-lists">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                  Collections
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  Browse lists
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Curated collections for peak-bagging, planning, and progress.
                </p>
              </div>
              <Link
                href="/lists"
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                View All
              </Link>
            </div>
            {lists.length === 0 ? (
              <div className="rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                No lists available
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {lists.map((list) => (
                  <ListCard key={list.id} list={list} />
                ))}
              </div>
            )}
          </section>

          <section id="recent-reports">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
                  Community beta
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  Recent trip reports
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Community beta and field notes from recent outings.
                </p>
              </div>
              <Link
                href={user ? "/reports/new" : "/register"}
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
              >
                {user ? "Write a report" : "Join to contribute"}
              </Link>
            </div>
            {recentReports.length === 0 ? (
              <div className="rounded-3xl border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                No public trip reports yet
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {recentReports.map((report) => (
                  <TripReportCard key={report.id} report={report} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CatalogStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-gray-400">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-stone-950 dark:text-white">
        {value}
      </div>
      <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-gray-300">
        {detail}
      </p>
    </div>
  );
}

function QuickBrowseCard({
  href,
  eyebrow,
  title,
  detail,
}: {
  href: string;
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[24px] border border-stone-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-gray-400">
        {eyebrow}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-tight text-stone-950 transition-colors group-hover:text-emerald-800 dark:text-white dark:group-hover:text-emerald-300">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-gray-300">
        {detail}
      </p>
    </Link>
  );
}

function SearchSection({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">
          {title} ({count})
        </h3>
        <p className="mt-1 text-sm text-stone-500 dark:text-gray-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </div>
      }
    >
      <DiscoverContent />
    </Suspense>
  );
}
