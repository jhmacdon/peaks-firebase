"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getSession,
  getSessionPoints,
  getSessionDestinations,
  getSessionRoutes,
} from "../../../../lib/actions/sessions";
import type {
  SessionDetail,
  SessionPoint,
  SessionDestination,
  SessionRoute,
} from "../../../../lib/actions/sessions";

const SessionMap = dynamic(() => import("../../../../components/session-map"), {
  ssr: false,
});
const ElevationProfile = dynamic(
  () => import("../../../../components/elevation-profile"),
  { ssr: false }
);

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPace(metersPerSecond: number): string {
  // Convert m/s to min/mi
  const minPerMile = 1609.34 / metersPerSecond / 60;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
}

/** Build cumulative distance array from GPS points (in meters) */
function buildDistances(points: SessionPoint[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const dlat = points[i].lat - points[i - 1].lat;
    const dlng = points[i].lng - points[i - 1].lng;
    // Approximate meter distance using Haversine-like flat-earth for small deltas
    const latRad = (points[i].lat * Math.PI) / 180;
    const dx = dlng * (Math.PI / 180) * 6371000 * Math.cos(latRad);
    const dy = dlat * (Math.PI / 180) * 6371000;
    const dist = Math.sqrt(dx * dx + dy * dy);
    distances.push(distances[i - 1] + dist);
  }
  return distances;
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { getIdToken } = useAuth();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [points, setPoints] = useState<SessionPoint[]>([]);
  const [destinations, setDestinations] = useState<SessionDestination[]>([]);
  const [routes, setRoutes] = useState<SessionRoute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getIdToken();
      if (!token) return;

      const [s, p, d, r] = await Promise.all([
        getSession(token, id),
        getSessionPoints(token, id),
        getSessionDestinations(id),
        getSessionRoutes(id),
      ]);

      setSession(s);
      setPoints(p);
      setDestinations(d);
      setRoutes(r);
      setLoading(false);
    }
    load();
  }, [id, getIdToken]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">
          Session not found
        </div>
      </div>
    );
  }

  const date = new Date(session.start_time);

  // Derive display name: explicit name > destination names > fallback
  const displayName = session.name
    || (destinations.length > 0
      ? destinations
          .filter((d) => d.name)
          .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0))
          .map((d) => d.name)
          .join(", ") || "Untitled Session"
      : "Untitled Session");

  // Build elevation profile data
  const distances = buildDistances(points);
  const elevationPoints = points
    .map((p, i) => ({
      dist: distances[i],
      ele: p.elevation ?? 0,
    }))
    .filter((p) => p.ele !== 0);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/log"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Session Log
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          {displayName}
        </span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">
          {displayName}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <StatCard
          label="Distance"
          value={
            session.distance != null
              ? `${(session.distance / 1609.34).toFixed(1)} mi`
              : "--"
          }
        />
        <StatCard
          label="Elevation Gain"
          value={
            session.gain != null
              ? `${Math.round(session.gain * 3.28084).toLocaleString()} ft`
              : "--"
          }
        />
        <StatCard
          label="Time"
          value={
            session.total_time != null
              ? formatDuration(session.total_time)
              : "--"
          }
        />
        <StatCard
          label="Highest Point"
          value={
            session.highest_point != null
              ? `${Math.round(session.highest_point * 3.28084).toLocaleString()} ft`
              : "--"
          }
        />
        <StatCard
          label="Pace"
          value={
            session.pace != null && session.pace > 0
              ? formatPace(session.pace)
              : "--"
          }
        />
      </div>

      {/* GPS Track Map */}
      {points.length > 0 && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="font-semibold mb-3">GPS Track</h3>
          <SessionMap points={points} />
        </div>
      )}

      {/* Elevation Profile */}
      {elevationPoints.length >= 2 && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Elevation Profile</h3>
          <ElevationProfile points={elevationPoints} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Destinations Reached */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Destinations Reached ({destinations.length})
          </h3>
          {destinations.length === 0 ? (
            <p className="text-sm text-gray-500">No destinations reached</p>
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
                      {dest.name || "Unnamed Destination"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {dest.elevation != null
                        ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                        : ""}
                      {dest.features.length > 0
                        ? ` · ${dest.features.join(", ")}`
                        : ""}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 capitalize">
                    {dest.relation}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Routes Followed */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Routes ({routes.length})
          </h3>
          {routes.length === 0 ? (
            <p className="text-sm text-gray-500">No routes matched</p>
          ) : (
            <div className="space-y-2">
              {routes.map((route) => (
                <Link
                  key={route.id}
                  href={`/routes/${route.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {route.name || "Unnamed Route"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {route.distance != null
                        ? `${(route.distance / 1609.34).toFixed(1)} mi`
                        : ""}
                      {route.gain != null
                        ? ` · ${Math.round(route.gain * 3.28084).toLocaleString()} ft gain`
                        : ""}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}
