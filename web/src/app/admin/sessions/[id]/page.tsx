"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import AdminGuard from "../../../../components/admin-guard";
import AdminNav from "../../../../components/admin-nav";
import UserPopover from "../../../../components/user-popover";
import {
  getAdminSession,
  getAdminSessionPoints,
  getAdminSessionDestinations,
  type AdminSessionDetail,
  type AdminSessionPoint,
  type AdminSessionDestination,
} from "../../../../lib/actions/admin-sessions";

const SessionMap = dynamic(
  () => import("../../../../components/session-map"),
  { ssr: false }
);
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
  const minPerMile = 1609.34 / metersPerSecond / 60;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
}

function buildDistances(points: AdminSessionPoint[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const dlat = points[i].lat - points[i - 1].lat;
    const dlng = points[i].lng - points[i - 1].lng;
    const latRad = (points[i].lat * Math.PI) / 180;
    const dx = dlng * (Math.PI / 180) * 6371000 * Math.cos(latRad);
    const dy = dlat * (Math.PI / 180) * 6371000;
    distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return distances;
}

export default function AdminSessionDetailPage() {
  return (
    <AdminGuard>
      <SessionDetailContent />
    </AdminGuard>
  );
}

function SessionDetailContent() {
  const params = useParams();
  const id = params.id as string;

  const [session, setSession] = useState<AdminSessionDetail | null>(null);
  const [points, setPoints] = useState<AdminSessionPoint[]>([]);
  const [destinations, setDestinations] = useState<AdminSessionDestination[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [s, p, d] = await Promise.all([
        getAdminSession(id),
        getAdminSessionPoints(id),
        getAdminSessionDestinations(id),
      ]);
      setSession(s);
      setPoints(p);
      setDestinations(d);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">
            Session not found
          </div>
        </main>
      </div>
    );
  }

  const date = new Date(session.start_time);
  const displayName =
    session.name ||
    (destinations.length > 0
      ? destinations
          .filter((d) => d.name)
          .map((d) => d.name)
          .join(", ") || "Untitled Session"
      : "Untitled Session");

  const distances = buildDistances(points);
  const elevationPoints = points
    .map((p, i) => ({ dist: distances[i], ele: p.elevation ?? 0 }))
    .filter((p) => p.ele !== 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link
            href="/admin/sessions"
            className="hover:text-gray-900 dark:hover:text-gray-100"
          >
            Sessions
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">
            {displayName}
          </span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold">{displayName}</h2>
          <div className="flex items-center gap-3 mt-2">
            <p className="text-sm text-gray-500">
              {date.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <UserPopover uid={session.user_id} />
            {session.source && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {session.source}
              </span>
            )}
            {session.processing_state && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  session.processing_state === "completed"
                    ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                    : session.processing_state === "failed"
                      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                      : "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                }`}
              >
                {session.processing_state}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 font-mono mt-1">{session.id}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          <StatCard
            label="Distance"
            value={
              session.distance != null
                ? `${(session.distance / 1609.34).toFixed(1)} mi`
                : "—"
            }
          />
          <StatCard
            label="Elevation Gain"
            value={
              session.gain != null
                ? `${Math.round(session.gain * 3.28084).toLocaleString()} ft`
                : "—"
            }
          />
          <StatCard
            label="Time"
            value={
              session.total_time != null
                ? formatDuration(session.total_time)
                : "—"
            }
          />
          <StatCard
            label="Highest Point"
            value={
              session.highest_point != null
                ? `${Math.round(session.highest_point * 3.28084).toLocaleString()} ft`
                : "—"
            }
          />
          <StatCard
            label="Pace"
            value={
              session.pace != null && session.pace > 0
                ? formatPace(session.pace)
                : "—"
            }
          />
        </div>

        {/* GPS Track Map */}
        {points.length > 0 && (
          <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">GPS Track</h3>
              <span className="text-xs text-gray-400">
                {points.length.toLocaleString()} points
              </span>
            </div>
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

        {/* Destinations */}
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Destinations ({destinations.length})
          </h3>
          {destinations.length === 0 ? (
            <p className="text-sm text-gray-500">No destinations matched</p>
          ) : (
            <div className="space-y-2">
              {destinations.map((dest) => (
                <Link
                  key={dest.id}
                  href={`/admin/destinations/${dest.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {dest.name || "Unnamed"}
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
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        dest.source === "auto"
                          ? "bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          : "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300"
                      }`}
                    >
                      {dest.source}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">
                      {dest.relation}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">Metadata</h3>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {session.ascent_time != null && (
              <div>
                <dt className="text-gray-500">Ascent Time</dt>
                <dd>{formatDuration(session.ascent_time)}</dd>
              </div>
            )}
            {session.descent_time != null && (
              <div>
                <dt className="text-gray-500">Descent Time</dt>
                <dd>{formatDuration(session.descent_time)}</dd>
              </div>
            )}
            {session.still_time != null && (
              <div>
                <dt className="text-gray-500">Still Time</dt>
                <dd>{formatDuration(session.still_time)}</dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Public</dt>
              <dd>{session.is_public ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Ended</dt>
              <dd>{session.ended ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd>{new Date(session.created_at).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Updated</dt>
              <dd>{new Date(session.updated_at).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>
      </main>
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
