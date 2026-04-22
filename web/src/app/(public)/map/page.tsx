"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  getDestinationsInViewport,
  getRoutesInViewport,
  type SearchDestination,
  type ViewportRoute,
} from "../../../lib/actions/search";
import { useAuth } from "../../../lib/auth-context";

const ExploreMap = dynamic(() => import("../../../components/explore-map"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800"
      style={{ height: "calc(100vh - 57px)" }}
    >
      <span className="text-gray-500">Loading map...</span>
    </div>
  ),
});

interface Viewport {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export default function MapPage() {
  const { user } = useAuth();
  const [destinations, setDestinations] = useState<SearchDestination[]>([]);
  const [routes, setRoutes] = useState<ViewportRoute[]>([]);
  const [showDestinations, setShowDestinations] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [loadingViewport, setLoadingViewport] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleViewportChange = useCallback((bounds: Viewport) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setLoadingViewport(true);
      try {
        const [dests, rts] = await Promise.all([
          getDestinationsInViewport(
            bounds.minLat,
            bounds.maxLat,
            bounds.minLng,
            bounds.maxLng
          ),
          getRoutesInViewport(
            bounds.minLat,
            bounds.maxLat,
            bounds.minLng,
            bounds.maxLng
          ),
        ]);
        setDestinations(dests);
        setRoutes(rts);
      } finally {
        setLoadingViewport(false);
      }
    }, 300);
  }, []);

  const visibleDestinations = destinations
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      elevation: d.elevation,
      lat: d.lat!,
      lng: d.lng!,
      features: d.features,
    }));

  const visibleRoutes = routes.map((r) => ({
    id: r.id,
    name: r.name,
    polyline6: r.polyline6,
  }));

  const mapDestinations = showDestinations ? visibleDestinations : [];
  const mapRoutes = showRoutes ? visibleRoutes : [];
  const featuredDestinations = visibleDestinations.slice(0, 5);
  const featuredRoutes = visibleRoutes.slice(0, 4);

  return (
    <div className="relative">
      <ExploreMap
        destinations={mapDestinations}
        routes={mapRoutes}
        onViewportChange={handleViewportChange}
      />

      <div className="pointer-events-none absolute inset-0 p-4 sm:p-6">
        <div className="pointer-events-auto mx-auto flex h-full max-w-7xl flex-col justify-between">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-xl rounded-[28px] border border-white/70 bg-white/92 p-5 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/92">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300">
                <span>Map explorer</span>
                {loadingViewport && <span className="text-gray-500">Updating…</span>}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
                Browse what’s visible right now.
              </h1>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                Pan across the map to load public destination guides and published
                routes. Zoom in for route overlays and use the toggles below to focus
                the view.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ToggleButton
                  active={showDestinations}
                  onClick={() => setShowDestinations((prev) => !prev)}
                >
                  {showDestinations ? "Hide" : "Show"} destinations
                </ToggleButton>
                <ToggleButton
                  active={showRoutes}
                  onClick={() => setShowRoutes((prev) => !prev)}
                >
                  {showRoutes ? "Hide" : "Show"} routes
                </ToggleButton>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MiniStat
                  label="Visible destinations"
                  value={visibleDestinations.length.toLocaleString("en-US")}
                />
                <MiniStat
                  label="Visible routes"
                  value={visibleRoutes.length.toLocaleString("en-US")}
                />
              </div>
            </div>

            <div className="max-w-sm rounded-[28px] border border-white/70 bg-white/92 p-5 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/92">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                Quick actions
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href="/discover"
                  className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Back to discover
                </Link>
                <Link
                  href={user ? "/plans/new" : "/register"}
                  className="rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-900 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-blue-700 dark:hover:text-blue-300"
                >
                  {user ? "Build a plan from this research" : "Create an account"}
                </Link>
              </div>
              <p className="mt-4 text-xs leading-5 text-gray-500">
                Routes appear as orange lines when you zoom in close enough for
                detailed geometry.
              </p>
            </div>
          </div>

          <div className="grid gap-4 pb-20 md:pb-6 lg:grid-cols-2">
            <ResultPanel
              title="Visible destinations"
              empty="Pan to a new area or turn destination markers back on."
              items={featuredDestinations.map((destination) => ({
                id: destination.id,
                href: `/destinations/${destination.id}`,
                title: destination.name || "Unnamed destination",
                subtitle: destination.elevation != null
                  ? `${Math.round(destination.elevation * 3.28084).toLocaleString()} ft`
                  : "Destination guide",
              }))}
            />
            <ResultPanel
              title="Visible routes"
              empty="Zoom in and pan across route-dense terrain to load published lines."
              items={featuredRoutes.map((route) => ({
                id: route.id,
                href: `/routes/${route.id}`,
                title: route.name || "Unnamed route",
                subtitle: "Published route guide",
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-950/60">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function ResultPanel({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; href: string; title: string; subtitle: string }>;
}) {
  return (
    <div className="pointer-events-auto rounded-[28px] border border-white/70 bg-white/92 p-5 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/92">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
        {title}
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm leading-6 text-gray-500">{empty}</p>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block rounded-2xl border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-800 dark:bg-gray-950/50 dark:hover:border-blue-700 dark:hover:bg-blue-950/10"
            >
              <div className="text-sm font-semibold text-gray-950 dark:text-white">
                {item.title}
              </div>
              <div className="mt-1 text-xs text-gray-500">{item.subtitle}</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
