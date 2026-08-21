"use client";

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
import { Button } from "../../../components/ui/button";
import { Chip } from "../../../components/ui/chip";
import { EmptyState } from "../../../components/ui/empty-state";
import { formatFeetValue, formatMilesValue } from "../../../lib/destination-detail";
import { formatDate } from "../../../lib/format";
import { LOADING_LABEL } from "../../../lib/constants";

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
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      {/* Import GPX is the page's one filled action (design-tokens.md law
          4); the filters and Load more sit on neutral fills below. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-medium text-ink">Session log</h1>
        <Button href="/log/import">Import GPX</Button>
      </div>

      {stats && (
        <div className="mt-10">
          <StatsBanner
            primary={{
              label:
                stats.destinations_reached === 1
                  ? "Peak reached"
                  : "Peaks reached",
              value: stats.destinations_reached.toLocaleString("en-US"),
            }}
            context={`${stats.total_sessions.toLocaleString(
              "en-US"
            )} recorded activities${
              latestActivityDate
                ? ` · Last activity ${formatDate(latestActivityDate)}`
                : ""
            }`}
            stats={[
              {
                label: "Distance",
                value: formatMilesValue(stats.total_distance) ?? "0",
                unit: "mi",
              },
              {
                label: "Elevation gain",
                value: formatFeetValue(stats.total_gain) ?? "0",
                unit: "ft",
              },
              {
                label: "Time",
                value: (stats.total_time / 3600).toFixed(1),
                unit: "hr",
              },
            ]}
          />
        </div>
      )}

      <div
        className="mt-12 flex flex-wrap gap-2"
        role="group"
        aria-label="Filter activities"
      >
        {ACTIVITY_FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            selected={activityFilter === filter.value}
            onClick={() => setActivityFilter(filter.value)}
          >
            {filter.label}
          </Chip>
        ))}
      </div>

      {loadError && !loading && (
        <p role="alert" className="mt-5 text-sm text-alert">
          {loadError}
        </p>
      )}

      {loading ? (
        <EmptyState className="mt-6">{LOADING_LABEL}</EmptyState>
      ) : loadError && sessions.length === 0 ? null : sessions.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No activities yet"
          description="Record with the Peaks app, or bring a track in from another tracker."
          action={
            <Button href="/log/import" variant="secondary">
              Import GPX
            </Button>
          }
        />
      ) : (
        <>
          <div className="mt-6 space-y-3">
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

          {total > offset && (
            <div className="mt-8 text-center">
              <Button
                variant="secondary"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? LOADING_LABEL : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
