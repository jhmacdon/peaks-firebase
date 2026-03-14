"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getUserSessions, getUserStats } from "@/lib/actions/sessions";
import type { SessionRow, UserStats } from "@/lib/actions/sessions";
import StatsBanner from "@/components/stats-banner";
import SessionCard from "@/components/session-card";

const LIMIT = 20;

export default function LogPage() {
  const { getIdToken } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const token = await getIdToken();
      if (!token) return;

      const [statsData, sessionsData] = await Promise.all([
        getUserStats(token),
        getUserSessions(token, LIMIT, 0),
      ]);

      setStats(statsData);
      setSessions(sessionsData.sessions);
      setTotal(sessionsData.total);
      setOffset(LIMIT);
      setLoading(false);
    }
    load();
  }, [getIdToken]);

  const loadMore = async () => {
    setLoadingMore(true);
    const token = await getIdToken();
    if (!token) return;

    const data = await getUserSessions(token, LIMIT, offset);
    setSessions((prev) => [...prev, ...data.sessions]);
    setTotal(data.total);
    setOffset((prev) => prev + LIMIT);
    setLoadingMore(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6">Session Log</h1>

      {/* Lifetime Stats Banner */}
      {stats && (
        <div className="mb-8">
          <StatsBanner
            stats={[
              { label: "Sessions", value: stats.total_sessions.toString() },
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
              {
                label: "Peaks Reached",
                value: stats.destinations_reached.toString(),
              },
            ]}
          />
        </div>
      )}

      {/* Session List */}
      {loading ? (
        <div className="text-gray-500 py-12 text-center">Loading...</div>
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
