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

function DiscoverContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
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

  // Load discover sections when no query
  useEffect(() => {
    if (query) return;
    let cancelled = false;
    async function loadSections() {
      try {
        const [popularDestinationResult, popularRouteResult, listsResult, reportsResult, statsResult] = await Promise.all([
          getPopularDestinations(12),
          getPopularRoutes(6),
          getLists(undefined, 6, 0),
          getRecentTripReports(4),
          getDiscoverStats(),
        ]);
        if (!cancelled) {
          setPopularDestinations(popularDestinationResult);
          setPopularRoutes(popularRouteResult);
          setLists(listsResult.lists);
          setRecentReports(reportsResult);
          setStats(statsResult);
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

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <section className="relative overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_24%)]" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:p-10">
          <div>
            <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300">
              Outdoor beta, maps, and progress
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-gray-950 dark:text-white sm:text-5xl">
              Discover peaks, published routes, lists, and community trip reports.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600 dark:text-gray-300">
              Search your next objective, jump into the full-screen map, and move from
              route research to planning and logging without leaving the app.
            </p>
            <div className="mt-6 max-w-3xl">
              <SearchBar placeholder="Search peaks, routes, and lists..." />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/map"
                className="rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Open map explorer
              </Link>
              <Link
                href={user ? "/plans/new" : "/register"}
                className="rounded-full border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-blue-700 dark:hover:text-blue-300"
              >
                {user ? "Build a trip plan" : "Create an account"}
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <HeroStat
              label="Destination guides"
              value={stats.destinationCount.toLocaleString("en-US")}
              detail="Peaks, shelters, trailheads, and waypoints"
            />
            <HeroStat
              label="Published routes"
              value={stats.routeCount.toLocaleString("en-US")}
              detail="Mapped and searchable public route pages"
            />
            <HeroStat
              label="Curated lists"
              value={stats.listCount.toLocaleString("en-US")}
              detail="Peak collections and progress tracking"
            />
          </div>
        </div>
      </section>

      {/* Search Results */}
      {query ? (
        <div className="mt-10 space-y-8">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {isSearching ? "Searching..." : `Results for "${query}"`}
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  {isSearching
                    ? "Looking across destination guides, route pages, and curated lists."
                    : `${totalSearchResults} result${totalSearchResults === 1 ? "" : "s"} across the public guide surface.`}
                </p>
              </div>
              <Link
                href="/map"
                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                Explore the map instead
              </Link>
            </div>
          </div>

          {!isSearching && totalSearchResults === 0 && (
            <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-900">
              No public destinations, routes, or lists matched &ldquo;{query}&rdquo;.
            </div>
          )}

          {destinationResults.length > 0 && (
            <SearchSection
              title="Destinations"
              count={destinationResults.length}
              description="Peaks, shelters, trailheads, and other mapped objectives."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {destinationResults.map((dest) => (
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

          {routeResults.length > 0 && (
            <SearchSection
              title="Routes"
              count={routeResults.length}
              description="Published route guides with maps, elevation, and segment breakdowns."
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {routeResults.map((route) => (
                  <RouteCard key={route.id} route={route} />
                ))}
              </div>
            </SearchSection>
          )}

          {listResults.length > 0 && (
            <SearchSection
              title="Lists"
              count={listResults.length}
              description="Curated collections you can browse and track."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {listResults.map((list) => (
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
          {/* Nearby Section */}
          {locationStatus !== "denied" && (
            <section>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Nearby</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Quick-hit objectives near your current location.
                  </p>
                </div>
                <Link
                  href="/map"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
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
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
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

          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
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
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Browse lists
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Curated collections for peak-bagging, planning, and progress.
                </p>
              </div>
              <Link
                href="/lists"
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
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

          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Recent trip reports
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Community beta and field notes from recent outings.
                </p>
              </div>
              <Link
                href={user ? "/reports/new" : "/register"}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
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

function HeroStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-950/60">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">
        {value}
      </div>
      <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
        {detail}
      </p>
    </div>
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
        <h3 className="text-2xl font-semibold tracking-tight">
          {title} ({count})
        </h3>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
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
