"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  getAreaPersonalActivity,
  type AreaDetail,
  type AreaPersonalActivity,
} from "../../../../lib/actions/areas";
import { useAuth } from "../../../../lib/auth-context";
import { areaKindLabel, describeDesignation, describeManager } from "../../../../lib/area-types";
import { formatRegionList } from "../../../../lib/regions";
import { AreaKindIcon } from "../../../../components/area-kind-icon";
import DestinationCard from "../../../../components/destination-card";
import { Breadcrumb, StatRow } from "../../../../components/detail-sections";
import RouteCard from "../../../../components/route-card";
import SessionCard from "../../../../components/session-card";

const AreaMap = dynamic(() => import("../../../../components/area-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-80 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400 sm:h-96">
      Loading map…
    </div>
  ),
});

export default function AreaDetailClient({ area }: { area: AreaDetail }) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [activity, setActivity] = useState<AreaPersonalActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const userId = user?.uid ?? null;
  const areaId = area.id;

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return () => {
      cancelled = true;
    };

    if (!userId) {
      setActivity(null);
      setActivityLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setActivity(null);
    setActivityLoading(true);
    getIdToken()
      .then((token) => {
        if (!token) return null;
        return getAreaPersonalActivity(token, areaId, 5);
      })
      .then((result) => {
        if (!cancelled) setActivity(result);
      })
      .catch(() => {
        if (!cancelled) setActivity(null);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [areaId, authLoading, getIdToken, userId]);

  const managerLabel = describeManager(area.manager);
  const regionLabel = formatRegionList(area.state_codes, area.country_code);
  const subtitle = [areaKindLabel(area.kind), managerLabel].filter(
    (value): value is string => Boolean(value)
  );
  const catalogSource = sourceLabel(area.source, area.source_version);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Breadcrumb current={area.name} />

        <header className="mt-4 flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
            <AreaKindIcon area={area} className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              {area.name}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {subtitle.join(" · ")}
            </p>
            {area.parent_id && area.parent_name && (
              <Link
                href={`/areas/${encodeURIComponent(area.parent_id)}`}
                className="mt-2 inline-flex text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
              >
                Within {area.parent_name}
              </Link>
            )}
          </div>
        </header>

        {userId && activityLoading && <ActivityLoadingCard />}
        {userId && activity && <ActivityCard activity={activity} />}

        <section className="mt-8 max-w-3xl" aria-labelledby="area-about">
          <h2
            id="area-about"
            className="text-xl font-semibold text-gray-900 dark:text-white"
          >
            About {area.name}
          </h2>
          <p className="mt-3 text-[15px] leading-7 text-gray-700 dark:text-gray-300">
            {area.description}
          </p>
          <DescriptionCredit area={area} catalogSource={catalogSource} />
        </section>

        <section className="mt-10" aria-labelledby="area-catalog">
          <h2
            id="area-catalog"
            className="text-xl font-semibold text-gray-900 dark:text-white"
          >
            Catalog facts
          </h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-800 dark:bg-gray-900">
              <strong className="text-gray-900 dark:text-white">
                {area.destination_count.toLocaleString("en-US")}{" "}
                {area.destination_count === 1 ? "destination" : "destinations"}
              </strong>
              <strong className="text-gray-900 dark:text-white">
                {area.route_count.toLocaleString("en-US")}{" "}
                {area.route_count === 1 ? "route" : "routes"}
              </strong>
            </div>
            <dl className="grid gap-x-8 gap-y-2 px-4 py-4 sm:grid-cols-2">
              <StatRow
                label="Designation"
                value={describeDesignation(area.designation, area.kind)}
              />
              {managerLabel && <StatRow label="Manager" value={managerLabel} />}
              {regionLabel && <StatRow label="Region" value={regionLabel} />}
            </dl>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <AreaMap
              areaId={area.id}
              name={area.name}
              lat={area.lat}
              lng={area.lng}
              bbox={area.bbox}
              boundary={area.boundary}
              destinations={area.destinations}
              routes={area.routes}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            The teal fill marks the protected-area boundary. Switch to satellite
            view from the map control.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="area-destinations">
          <div className="flex items-baseline justify-between gap-4">
            <h2
              id="area-destinations"
              className="text-xl font-semibold text-gray-900 dark:text-white"
            >
              Peaks and destinations
            </h2>
            {area.destination_count > area.destinations.length && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Showing {area.destinations.length} of{" "}
                {area.destination_count.toLocaleString("en-US")}
              </span>
            )}
          </div>
          {area.destinations.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No catalog destinations are linked to this area yet.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {area.destinations.map((destination) => (
                <DestinationCard
                  key={destination.id}
                  id={destination.id}
                  name={destination.name}
                  elevation={destination.elevation}
                  features={destination.features}
                />
              ))}
            </div>
          )}
        </section>

        {activity && activity.sessions.length > 0 && (
          <section className="mt-10" aria-labelledby="area-sessions">
            <div className="flex items-baseline justify-between gap-4">
              <h2
                id="area-sessions"
                className="text-xl font-semibold text-gray-900 dark:text-white"
              >
                Your recent sessions
              </h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {activity.visit_count.toLocaleString("en-US")} total
              </span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {activity.sessions.map((session) => (
                <SessionCard key={session.id} {...session} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-10" aria-labelledby="area-routes">
          <div className="flex items-baseline justify-between gap-4">
            <h2
              id="area-routes"
              className="text-xl font-semibold text-gray-900 dark:text-white"
            >
              Routes through here
            </h2>
            {area.route_count > area.routes.length && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Showing {area.routes.length} of{" "}
                {area.route_count.toLocaleString("en-US")}
              </span>
            )}
          </div>
          {area.routes.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No public routes are linked to this area yet.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {area.routes.map((route) => (
                <RouteCard key={route.id} route={route} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ActivityLoadingCard() {
  return (
    <div
      className="mt-8 rounded-xl border border-teal-100 bg-teal-50/60 px-5 py-6 text-sm text-teal-800 dark:border-teal-900/60 dark:bg-teal-950/20 dark:text-teal-300"
      aria-live="polite"
    >
      Loading your activity…
    </div>
  );
}

function ActivityCard({ activity }: { activity: AreaPersonalActivity }) {
  const visitLabel = activity.visit_count === 1 ? "visit" : "visits";
  const latestVisit = activity.latest_visit
    ? new Date(activity.latest_visit).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <section
      className="mt-8 overflow-hidden rounded-xl border border-teal-100 bg-teal-50/50 dark:border-teal-900/60 dark:bg-teal-950/20"
      aria-labelledby="area-personal-activity"
    >
      <div className="px-5 py-5">
        <p
          id="area-personal-activity"
          className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300"
        >
          Your activity
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
          <p>
            <span className="text-4xl font-bold tabular-nums text-gray-900 dark:text-white">
              {activity.visit_count.toLocaleString("en-US")}
            </span>{" "}
            <span className="text-lg font-semibold text-gray-600 dark:text-gray-300">
              {visitLabel}
            </span>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {latestVisit ? `Last visit ${latestVisit}` : "No recorded visits yet"}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-teal-100 border-t border-teal-100 bg-white/60 dark:divide-teal-900/60 dark:border-teal-900/60 dark:bg-gray-950/30">
        <ActivityMetric
          label="Distance"
          value={formatDistance(activity.total_distance)}
        />
        <ActivityMetric
          label="Elevation"
          value={formatElevation(activity.total_gain)}
        />
        <ActivityMetric label="Time" value={formatDuration(activity.total_time)} />
      </dl>
    </section>
  );
}

function ActivityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dd className="truncate text-sm font-bold tabular-nums text-gray-900 dark:text-white sm:text-base">
        {value}
      </dd>
      <dt className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </dt>
    </div>
  );
}

function DescriptionCredit({
  area,
  catalogSource,
}: {
  area: AreaDetail;
  catalogSource: string;
}) {
  if (area.description_source_name && area.description_source_url) {
    return (
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Adapted from{" "}
        <a
          href={area.description_source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-teal-700 hover:underline dark:text-teal-300"
        >
          {area.description_source_name}
        </a>
        {area.description_source_license
          ? ` · ${area.description_source_license}`
          : ""}
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
      Boundary data: {catalogSource}
    </p>
  );
}

function sourceLabel(source: string, version: string): string {
  const name = source.toLowerCase() === "padus" ? "USGS PAD-US" : source;
  return version ? `${name} ${version}` : name;
}

function formatDistance(meters: number): string {
  if (meters <= 0) return "—";
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatElevation(meters: number): string {
  if (meters <= 0) return "—";
  return `${Math.round(meters * 3.28084).toLocaleString("en-US")} ft`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
