"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getRoute,
  getRouteDestinations,
  getRouteElevation,
  getRouteSessionCount,
  type RouteDetail,
  type RouteDestination,
  type RouteElevationPoint,
} from "../../../../lib/actions/routes";

const RouteMap = dynamic(() => import("../../../../components/route-map"), {
  ssr: false,
});
const ElevationProfile = dynamic(
  () => import("../../../../components/elevation-profile"),
  { ssr: false }
);

export default function RouteDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [destinations, setDestinations] = useState<RouteDestination[]>([]);
  const [elevationPoints, setElevationPoints] = useState<
    RouteElevationPoint[]
  >([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [r, dests, elev, sessions] = await Promise.all([
        getRoute(id),
        getRouteDestinations(id),
        getRouteElevation(id),
        getRouteSessionCount(id),
      ]);
      setRoute(r);
      setDestinations(dests);
      setElevationPoints(elev);
      setSessionCount(sessions);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Route not found</div>
      </div>
    );
  }

  // Build elevation profile data (cumulative distance + elevation)
  const profilePoints = buildProfilePoints(elevationPoints);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          {route.name || "Unnamed Route"}
        </span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">
          {route.name || "Unnamed Route"}
        </h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <StatCard
          label="Distance"
          value={
            route.distance
              ? `${(route.distance / 1609.34).toFixed(1)} mi`
              : "\u2014"
          }
        />
        <StatCard
          label="Elevation Gain"
          value={
            route.gain
              ? `${Math.round(route.gain * 3.28084).toLocaleString()} ft`
              : "\u2014"
          }
        />
        <StatCard
          label="Elevation Loss"
          value={
            route.gain_loss
              ? `${Math.round(route.gain_loss * 3.28084).toLocaleString()} ft`
              : "\u2014"
          }
        />
        <StatCard
          label="Shape"
          value={route.shape?.replace(/_/g, " ") || "\u2014"}
        />
        <StatCard label="Sessions" value={sessionCount.toString()} />
      </div>

      {/* Map */}
      {route.polyline6 && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Route Map</h3>
          <RouteMap polyline6={route.polyline6} />
        </div>
      )}

      {/* Elevation Profile */}
      {profilePoints.length >= 2 && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Elevation Profile</h3>
          <ElevationProfile points={profilePoints} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">Details</h3>
          <dl className="space-y-3 text-sm">
            <DetailRow label="Shape">
              <span className="capitalize">
                {route.shape?.replace(/_/g, " ") || "\u2014"}
              </span>
            </DetailRow>
            <DetailRow label="Completion">
              <span className="capitalize">{route.completion}</span>
            </DetailRow>
            {route.elevation_string && (
              <DetailRow label="Elevation">{route.elevation_string}</DetailRow>
            )}
            {route.external_links && route.external_links.length > 0 && (
              <DetailRow label="External Links">
                <div className="flex gap-2">
                  {route.external_links.map((link: { type: string; id: string }, i: number) => (
                    <span
                      key={i}
                      className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800"
                    >
                      {link.type.toUpperCase()}: {link.id}
                    </span>
                  ))}
                </div>
              </DetailRow>
            )}
          </dl>
        </div>

        {/* Destinations */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Destinations ({destinations.length})
          </h3>
          {destinations.length === 0 ? (
            <p className="text-sm text-gray-500">No destinations linked</p>
          ) : (
            <div className="space-y-2">
              {destinations.map((dest) => (
                <Link
                  key={dest.id}
                  href={`/destinations/${dest.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {dest.name || "Unknown"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {dest.elevation
                        ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                        : ""}
                      {Array.isArray(dest.features) &&
                        dest.features.length > 0 &&
                        ` \u00B7 ${dest.features.join(", ")}`}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">
                    #{dest.ordinal}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build cumulative-distance elevation profile from raw points */
function buildProfilePoints(
  points: RouteElevationPoint[]
): { dist: number; ele: number }[] {
  if (points.length === 0) return [];

  const result: { dist: number; ele: number }[] = [];
  let cumDist = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      cumDist += haversine(
        points[i - 1].lat,
        points[i - 1].lng,
        points[i].lat,
        points[i].lng
      );
    }
    result.push({ dist: cumDist, ele: points[i].elevation });
  }

  return result;
}

/** Haversine distance in meters between two lat/lng points */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-gray-500 shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
