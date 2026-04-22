"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getRoute,
  getRouteDestinations,
  getRouteElevation,
  getRouteSegments,
  getRouteSessionCount,
  type RouteDetail,
  type RouteDestination,
  type RouteElevationPoint,
  type RouteSegment,
} from "../../../../lib/actions/routes";
import RouteSegmentList from "../../../../components/route-segment-list";
import RouteExternalLinks from "../../../../components/route-external-links";
import {
  describeCompletionMode,
  describeRouteShape,
  formatDistanceMeters,
  formatDurationHours,
  formatDurationRange,
  formatElevationMeters,
  summarizeRouteGuide,
  summarizeSegments,
} from "../../../../lib/route-guide";

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
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [elevationPoints, setElevationPoints] = useState<
    RouteElevationPoint[]
  >([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [r, dests, elev, sessions, routeSegments] = await Promise.all([
        getRoute(id, { publicOnly: true }),
        getRouteDestinations(id, { publicOnly: true }),
        getRouteElevation(id, { publicOnly: true }),
        getRouteSessionCount(id, { publicOnly: true }),
        getRouteSegments(id, { publicOnly: true }),
      ]);
      setRoute(r);
      setDestinations(dests);
      setElevationPoints(elev);
      setSessionCount(sessions);
      setSegments(routeSegments);
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
  const guide = summarizeRouteGuide(route, segments.length);
  const segmentSummary = summarizeSegments(segments);
  const externalLinks = route.external_links;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
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
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-6 shadow-sm dark:border-gray-800 dark:from-gray-950 dark:via-gray-900 dark:to-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.12),transparent_32%)]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300">
              Public route guide
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {route.name || "Unnamed Route"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              {guide.routeNarrative || "A public route overview with destinations, geometry, and route-level details."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Pill>{describeRouteShape(route.shape)}</Pill>
              <Pill>
                {route.completion === "none"
                  ? "Any direction"
                  : route.completion.replace(/_/g, " ")}
              </Pill>
              <Pill>{sessionCount} sessions</Pill>
              <Pill>{segmentSummary.count} segments</Pill>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Difficulty
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {guide.difficultyLabel}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Driven by {guide.difficultyReason}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Estimated time
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {formatDurationRange(guide.estimatedHoursLow, guide.estimatedHoursHigh)}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {formatDurationHours(guide.estimatedHoursMid)} midpoint hike
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Distance"
          value={formatDistanceMeters(route.distance)}
          detail={guide.routeShapeLabel}
        />
        <StatCard
          label="Elevation Gain"
          value={formatElevationMeters(route.gain)}
          detail={
            guide.climbingDensityFeetPerMile != null
              ? `${Math.round(guide.climbingDensityFeetPerMile).toLocaleString()} ft/mi`
              : "Climbing density"
          }
        />
        <StatCard
          label="Elevation Loss"
          value={formatElevationMeters(route.gain_loss)}
          detail="Descent"
        />
        <StatCard
          label="Est. time"
          value={formatDurationRange(guide.estimatedHoursLow, guide.estimatedHoursHigh)}
          detail={formatDurationHours(guide.estimatedHoursMid)}
        />
        <StatCard
          label="Difficulty"
          value={guide.difficultyLabel}
          detail={guide.difficultyReason}
        />
        <StatCard
          label="Destinations"
          value={destinations.length.toString()}
          detail={`${route.destination_count} linked in data`}
        />
      </div>

      {/* Map */}
      {route.polyline6 && (
        <div className="mb-8 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="font-semibold">Route Map</h3>
            <span className="text-xs text-gray-500">
              {guide.routeShapeLabel}
            </span>
          </div>
          <RouteMap polyline6={route.polyline6} />
        </div>
      )}

      {/* Elevation Profile */}
      {profilePoints.length >= 2 && (
        <div className="mb-8 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="font-semibold">Elevation Profile</h3>
            <span className="text-xs text-gray-500">
              {guide.climbingDensityFeetPerMile != null
                ? `${Math.round(guide.climbingDensityFeetPerMile).toLocaleString()} ft/mi`
                : "Derived from route geometry"}
            </span>
          </div>
          <ElevationProfile points={profilePoints} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Details */}
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="font-semibold mb-4">Details</h3>
          <dl className="space-y-3 text-sm">
            <DetailRow label="Guide summary">
              <span className="text-right text-gray-600 dark:text-gray-300">
                {guide.routeNarrative}
              </span>
            </DetailRow>
            <DetailRow label="Shape">
              <span className="capitalize">
                {describeRouteShape(route.shape)}
              </span>
            </DetailRow>
            <DetailRow label="Completion">
              <span>{describeCompletionMode(route.completion)}</span>
            </DetailRow>
            {route.elevation_string && (
              <DetailRow label="Elevation">{route.elevation_string}</DetailRow>
            )}
            <DetailRow label="Sessions">
              <span>{sessionCount.toLocaleString()}</span>
            </DetailRow>
            <DetailRow label="Segments">
              <span>{segmentSummary.count}</span>
            </DetailRow>
            <DetailRow label="External Links">
              <span>{Array.isArray(externalLinks) ? externalLinks.length : 0}</span>
            </DetailRow>
          </dl>
        </div>

        {/* Destinations */}
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="font-semibold mb-4">
            Destinations ({destinations.length})
          </h3>
          {destinations.length === 0 ? (
            <p className="text-sm text-gray-500">No destinations linked</p>
          ) : (
            <div className="space-y-3">
              {destinations.map((dest, index) => (
                <Link
                  key={dest.id}
                  href={`/destinations/${dest.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/30 dark:border-gray-800 dark:hover:border-blue-700 dark:hover:bg-blue-950/10"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm">
                        {dest.name || "Unknown"}
                      </div>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {index === 0
                          ? "Start"
                          : index === destinations.length - 1
                            ? "Finish"
                            : `Waypoint ${index + 1}`}
                      </span>
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
                    #{dest.ordinal + 1}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="font-semibold">Segment breakdown</h3>
            <span className="text-xs text-gray-500">
              {segmentSummary.mostSharedCount > 1
                ? `Most reused on ${segmentSummary.mostSharedCount} routes`
                : "Route-specific geometry"}
            </span>
          </div>
          {segments.length === 0 ? (
            <p className="text-sm text-gray-500">No segment data available</p>
          ) : (
            <RouteSegmentList segments={segments} />
          )}
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="font-semibold mb-4">External resources</h3>
          <RouteExternalLinks links={externalLinks} />
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

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-blue-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 shadow-sm dark:border-blue-900 dark:bg-gray-900/80 dark:text-blue-300">
      {children}
    </span>
  );
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

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {detail && (
        <div className="mt-1 text-xs text-gray-400">
          {detail}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-gray-500 shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
