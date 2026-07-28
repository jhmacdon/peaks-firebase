"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth-context";
import { getUserSessions, getUserStats } from "../../../lib/actions/sessions";
import type {
  SessionActivityFilter,
  SessionRow,
  UserStats,
} from "../../../lib/actions/sessions";
import StatsBanner from "../../../components/stats-banner";
import SessionCard from "../../../components/session-card";

const LIMIT = 20;
const ACTIVITY_FILTERS: {
  value: SessionActivityFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "outdoor-trek", label: "Hikes" },
  { value: "ski", label: "Ski" },
  { value: "outdoor-moto", label: "Moto" },
  { value: "unknown", label: "Other" },
];

export default function LogPage() {
  const { getIdToken } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [activityFilter, setActivityFilter] =
    useState<SessionActivityFilter>("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [latestActivityDate, setLatestActivityDate] = useState<string | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Sign in to view your session log");

        const [statsData, sessionsData] = await Promise.all([
          getUserStats(token),
          getUserSessions(token, LIMIT, 0, activityFilter),
        ]);

        if (cancelled) return;
        setStats(statsData);
        setSessions(sessionsData.sessions);
        setTotal(sessionsData.total);
        setOffset(LIMIT);
        if (activityFilter === "all") {
          setLatestActivityDate(sessionsData.sessions[0]?.start_time ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The session log could not be loaded"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, activityFilter]);

  const loadMore = async () => {
    setLoadingMore(true);
    setLoadError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in to view your session log");

      const data = await getUserSessions(
        token,
        LIMIT,
        offset,
        activityFilter
      );
      setSessions((prev) => [...prev, ...data.sessions]);
      setTotal(data.total);
      setOffset((prev) => prev + LIMIT);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "More sessions could not be loaded"
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Session Log</h1>
        <Link
          href="/log/import"
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
        >
          Import GPX
        </Link>
      </div>

      {/* Lifetime Stats Banner */}
      {stats && (
        <div className="mb-8">
          <StatsBanner
            primary={{
              label:
                stats.destinations_reached === 1
                  ? "peak reached"
                  : "peaks reached",
              value: stats.destinations_reached.toString(),
            }}
            context={`${stats.total_sessions.toLocaleString(
              "en-US"
            )} recorded activities${
              latestActivityDate
                ? ` · Last activity ${new Date(
                    latestActivityDate
                  ).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : ""
            }`}
            stats={[
              {
                label: "Distance",
                value: `${(stats.total_distance / 1609.34).toFixed(1)} mi`,
              },
              {
                label: "Elevation Gain",
                value: `${Math.round(stats.total_gain * 3.28084).toLocaleString()} ft`,
              },
              {
                label: "Time",
                value: `${(stats.total_time / 3600).toFixed(1)} hrs`,
              },
            ]}
          />
        </div>
      )}

      <div
        className="mb-5 flex flex-wrap gap-2"
        role="group"
        aria-label="Filter activities"
      >
        {ACTIVITY_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setActivityFilter(filter.value)}
            aria-pressed={activityFilter === filter.value}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              activityFilter === filter.value
                ? "border-teal-700 bg-teal-700 text-white"
                : "border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loadError && !loading && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {loadError}
        </div>
      )}

      {/* Session List */}
      {loading ? (
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      ) : loadError && sessions.length === 0 ? (
        null
      ) : sessions.length === 0 ? (
        <div className="text-gray-500 py-12 text-center">No sessions found</div>
      ) : (
        <>
          <div className="space-y-3">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                id={session.id}
                name={session.name}
                destinationNames={session.destinationNames}
                start_time={session.start_time}
                distance={session.distance}
                gain={session.gain}
                total_time={session.total_time}
                activity_type={session.activity_type}
              />
            ))}
          </div>

          {/* Load More */}
          {total > offset && (
            <div className="mt-6 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium hover:border-blue-300 dark:hover:border-blue-700 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
