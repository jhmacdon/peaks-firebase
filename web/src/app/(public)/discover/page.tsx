"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SearchBar from "@/components/search-bar";
import DestinationCard from "@/components/destination-card";
import {
  searchDestinations,
  getNearbyDestinations,
  getPopularDestinations,
  type SearchDestination,
} from "@/lib/actions/search";
import { getLists, type ListRow } from "@/lib/actions/lists";

function DiscoverContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";

  const [nearby, setNearby] = useState<SearchDestination[]>([]);
  const [popular, setPopular] = useState<SearchDestination[]>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "pending" | "granted" | "denied"
  >(typeof window !== "undefined" && navigator.geolocation ? "pending" : "denied");
  const [sectionsLoaded, setSectionsLoaded] = useState(false);
  const hasLocation = userLat !== null && userLng !== null;

  const [searchResults, setSearchResults] = useState<{
    query: string;
    results: SearchDestination[];
  }>({ query: "", results: [] });
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
    if (!query) return;
    let cancelled = false;
    async function search() {
      setSearchLoading(true);
      const res = await searchDestinations(
        query,
        userLat ?? undefined,
        userLng ?? undefined
      );
      if (!cancelled) {
        setSearchResults({ query, results: res });
        setSearchLoading(false);
      }
    }
    search();
    return () => {
      cancelled = true;
    };
  }, [query, userLat, userLng]);

  // Derive displayed results: show results matching current query, or empty if no query
  const displayResults = useMemo(() => {
    if (!query) return [];
    if (searchResults.query === query) return searchResults.results;
    return [];
  }, [query, searchResults]);

  const isSearching = query
    ? searchLoading || searchResults.query !== query
    : false;

  // Load discover sections when no query
  useEffect(() => {
    if (query) return;
    let cancelled = false;
    async function loadSections() {
      const [pop, listsResult] = await Promise.all([
        getPopularDestinations(12),
        getLists(undefined, 6, 0),
      ]);
      if (!cancelled) {
        setPopular(pop);
        setLists(listsResult.lists);
        setSectionsLoaded(true);
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
      const near = await getNearbyDestinations(
        userLat!,
        userLng!,
        50000,
        12
      );
      if (!cancelled) {
        setNearby(near);
      }
    }
    loadNearby();
    return () => {
      cancelled = true;
    };
  }, [query, hasLocation, userLat, userLng]);

  const loading = !query && !sectionsLoaded;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Hero Search */}
      <div className="mb-10">
        {!query && (
          <h1 className="text-3xl font-bold mb-2">Discover</h1>
        )}
        {!query && (
          <p className="text-gray-500 mb-6">
            Search peaks, trails, and destinations
          </p>
        )}
        <SearchBar placeholder="Search peaks, trails, and destinations..." />
      </div>

      {/* Search Results */}
      {query ? (
        <div>
          <h2 className="text-lg font-semibold mb-4">
            {isSearching
              ? "Searching..."
              : `Results for "${query}" (${displayResults.length})`}
          </h2>
          {!isSearching && displayResults.length === 0 && (
            <p className="text-gray-500 py-8 text-center">
              No destinations found for &ldquo;{query}&rdquo;
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayResults.map((dest) => (
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
        </div>
      ) : loading ? (
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      ) : (
        <div className="space-y-12">
          {/* Nearby Section */}
          {locationStatus !== "denied" && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Nearby</h2>
              </div>
              {!hasLocation ? (
                <div className="text-sm text-gray-500 py-6 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                  Requesting your location...
                </div>
              ) : nearby.length === 0 ? (
                <div className="text-sm text-gray-500 py-6 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                  No destinations found nearby
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Popular</h2>
            </div>
            {popular.length === 0 ? (
              <div className="text-sm text-gray-500 py-6 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                No popular destinations yet
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {popular.map((dest) => (
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

          {/* Browse Lists Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Browse Lists</h2>
              <Link
                href="/lists"
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                View All
              </Link>
            </div>
            {lists.length === 0 ? (
              <div className="text-sm text-gray-500 py-6 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                No lists available
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {lists.map((list) => (
                  <Link
                    key={list.id}
                    href={`/lists/${list.id}`}
                    className="block p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div className="font-medium">{list.name}</div>
                    {list.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {list.description}
                      </p>
                    )}
                    <div className="text-xs text-gray-400 mt-2">
                      {list.destination_count} destination
                      {list.destination_count !== 1 ? "s" : ""}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
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
