"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import Link from "next/link";
import {
  getSession,
  getSessionPoints,
  getSessionDestinations,
  getSessionRoutes,
  getSessionAreas,
} from "../../../../lib/actions/sessions";
import { getPublicSessionBundle } from "../../../../lib/actions/public-sessions";
import type {
  SessionDetail,
  SessionPoint,
  SessionDestination,
  SessionRoute,
} from "../../../../lib/actions/sessions";
import { AreaChips } from "../../../../components/area-chip";
import type { ProtectedArea } from "../../../../lib/area-types";
import SessionPlayback from "../../../../components/session-playback";
import SessionActions from "../../../../components/session-actions";
import SessionHealthSummary from "../../../../components/session-health-summary";
import { sessionActivityLabel } from "../../../../lib/session-track";
import { LOADING_LABEL } from "../../../../lib/constants";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPace(metersPerSecond: number): string {
  // Convert m/s to min/mi
  const totalSeconds = Math.round(1609.34 / metersPerSecond);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user, loading: authLoading, getIdToken } = useAuth();
  const userId = user?.uid ?? null;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [points, setPoints] = useState<SessionPoint[]>([]);
  const [destinations, setDestinations] = useState<SessionDestination[]>([]);
  const [routes, setRoutes] = useState<SessionRoute[]>([]);
  const [areas, setAreas] = useState<ProtectedArea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) {
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setLoading(true);
      try {
        if (!userId) {
          const bundle = await getPublicSessionBundle(id);
          if (cancelled) return;

          setSession(bundle?.session ?? null);
          setPoints(bundle?.points ?? []);
          setDestinations(bundle?.destinations ?? []);
          setRoutes(bundle?.routes ?? []);
          setAreas(bundle?.areas ?? []);
          return;
        }

        const token = await getIdToken();
        if (!token) throw new Error("Missing sign-in token");

        const [nextSession, nextPoints, nextDestinations, nextRoutes, nextAreas] =
          await Promise.all([
            getSession(token, id),
            getSessionPoints(token, id),
            getSessionDestinations(token, id),
            getSessionRoutes(token, id),
            getSessionAreas(token, id),
          ]);

        if (cancelled) return;
        setSession(nextSession);
        setPoints(nextPoints);
        setDestinations(nextDestinations);
        setRoutes(nextRoutes);
        setAreas(nextAreas);
      } catch {
        if (!cancelled) {
          setSession(null);
          setPoints([]);
          setDestinations([]);
          setRoutes([]);
          setAreas([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, id, userId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">{LOADING_LABEL}</div>
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
  const reachedDestinations = destinations.filter(
    (destination) => destination.relation === "reached"
  );
  const goalDestinations = destinations.filter(
    (destination) => destination.relation === "goal"
  );
  const namingDestinations =
    reachedDestinations.length > 0 ? reachedDestinations : goalDestinations;

  // Derive display name: explicit name > destination names > fallback
  const displayName = session.name
    || (namingDestinations.length > 0
      ? namingDestinations
          .filter((d) => d.name)
          .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0))
          .map((d) => d.name)
          .join(", ") || "Untitled Session"
      : "Untitled Session");

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href={userId ? "/log" : "/discover"}
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          {userId ? "Session Log" : "Discover"}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          {displayName}
        </span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {sessionActivityLabel(session.activity_type)} ·{" "}
            {date.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}{" "}
            · {session.is_public ? "Public" : "Private"}
          </p>
          <AreaChips areas={areas} className="mt-3" />
        </div>
        <SessionActions
          session={session}
          displayName={displayName}
          onUpdated={(updates) =>
            setSession((current) =>
              current ? { ...current, ...updates } : current
            )
          }
        />
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-400">
              Activity summary
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums">
              {session.distance != null
                ? `${(session.distance / 1609.34).toFixed(1)} mi`
                : "—"}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {reachedDestinations.length > 0
                ? `${reachedDestinations.length} reached destination${
                    reachedDestinations.length === 1 ? "" : "s"
                  }`
                : "Recorded GPS activity"}
            </div>
          </div>
          <div className="grid min-w-full grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:min-w-[560px] sm:grid-cols-4 dark:border-gray-800 dark:bg-gray-800">
            <SummaryMetric
              label="Elevation"
              value={
                session.gain != null
                  ? `${Math.round(
                      session.gain * 3.28084
                    ).toLocaleString()} ft`
                  : "—"
              }
            />
            <SummaryMetric
              label="Time"
              value={
                session.total_time != null
                  ? formatDuration(session.total_time)
                  : "—"
              }
            />
            <SummaryMetric
              label="High point"
              value={
                session.highest_point != null
                  ? `${Math.round(
                      session.highest_point * 3.28084
                    ).toLocaleString()} ft`
                  : "—"
              }
            />
            <SummaryMetric
              label="Pace"
              value={
                session.pace != null && session.pace > 0
                  ? formatPace(session.pace)
                  : "—"
              }
            />
          </div>
        </div>
      </div>

      {points.length > 0 && (
        <div className="mb-8">
          <SessionPlayback points={points} healthData={session.health_data} />
        </div>
      )}

      <SessionHealthSummary healthData={session.health_data} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Destinations Reached */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Destinations Reached ({reachedDestinations.length})
          </h3>
          {reachedDestinations.length === 0 ? (
            <p className="text-sm text-gray-500">No destinations reached</p>
          ) : (
            <div className="space-y-2">
              {reachedDestinations.map((dest) => (
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
                </Link>
              ))}
            </div>
          )}
        </div>

        {goalDestinations.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="font-semibold mb-4">
              Planned Destinations ({goalDestinations.length})
            </h3>
            <div className="space-y-2">
              {goalDestinations.map((destination) => (
                <Link
                  key={destination.id}
                  href={`/destinations/${destination.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {destination.name || "Unnamed Destination"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {destination.elevation != null
                        ? `${Math.round(
                            destination.elevation * 3.28084
                          ).toLocaleString()} ft`
                        : ""}
                      {destination.features.length > 0
                        ? ` · ${destination.features.join(", ")}`
                        : ""}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-teal-700 dark:text-teal-300">
                    Goal
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

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

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-2.5 dark:bg-gray-900">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}
