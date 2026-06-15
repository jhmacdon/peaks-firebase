"use client";

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
import {
  describeCompletionMode,
  describeRouteShape,
  formatDistanceMeters,
  formatDurationRange,
  formatElevationMeters,
  parseExternalRouteLinks,
  summarizeRouteGuide,
} from "../../../../lib/route-guide";
import {
  Breadcrumb,
  DifficultyPill,
  SidePanel,
  StatCell,
  StatRow,
  titleize,
} from "../../../../components/detail-sections";
import { AreaChips } from "../../../../components/area-chip";

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
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="text-gray-500 py-16 text-center text-sm">Loading…</div>
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="text-gray-500 py-16 text-center text-sm">
            Route not found
          </div>
        </div>
      </div>
    );
  }

  const name = route.name || "Unnamed Route";
  const guide = summarizeRouteGuide(route, segments.length);
  const profilePoints = buildProfilePoints(elevationPoints);
  const externalLinks = parseExternalRouteLinks(route.external_links);

  const start = destinations[0];
  const directionsUrl =
    start && start.lat != null && start.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${start.lat},${start.lng}`
      : null;

  const metaParts = [
    describeRouteShape(route.shape),
    destinations.length > 0
      ? `${destinations.length} waypoint${destinations.length === 1 ? "" : "s"}`
      : null,
    sessionCount > 0
      ? `${sessionCount.toLocaleString("en-US")} recorded session${sessionCount === 1 ? "" : "s"}`
      : null,
  ].filter((part): part is string => part != null);

  const aboutParagraphs = buildAbout(name, route, guide, sessionCount);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumb current={name} />

        <header className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                {name}
              </h1>
              <DifficultyPill label={guide.difficultyLabel} />
            </div>
            {metaParts.length > 0 && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {metaParts.map(titleizeFirst).join(" · ")}
              </p>
            )}
            <AreaChips areas={route.areas} className="mt-2" />
          </div>
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Directions to start
            </a>
          )}
        </header>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-5 dark:border-gray-800 dark:bg-gray-800">
          <StatCell label="Distance" value={formatDistanceMeters(route.distance)} />
          <StatCell
            label="Elevation gain"
            value={formatElevationMeters(route.gain)}
          />
          <StatCell
            label="Elevation loss"
            value={formatElevationMeters(route.gain_loss)}
          />
          <StatCell
            label="Est. time"
            value={formatDurationRange(
              guide.estimatedHoursLow,
              guide.estimatedHoursHigh
            )}
          />
          <StatCell label="Difficulty" value={guide.difficultyLabel} />
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                About {name}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-7 text-gray-700 dark:text-gray-300">
                {aboutParagraphs.map((paragraph, index) => (
                  <p key={`${index}-${paragraph}`}>{paragraph}</p>
                ))}
              </div>
            </section>

            {route.polyline6 && (
              <section className="mt-10">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Map
                </h2>
                <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                  <RouteMap polyline6={route.polyline6} />
                </div>
              </section>
            )}

            {profilePoints.length >= 2 && (
              <section className="mt-10">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Elevation profile
                  </h2>
                  {guide.climbingDensityFeetPerMile != null && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {Math.round(guide.climbingDensityFeetPerMile).toLocaleString()}{" "}
                      ft/mi average
                    </span>
                  )}
                </div>
                <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                  <ElevationProfile points={profilePoints} />
                </div>
              </section>
            )}

            <section className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Waypoints{destinations.length > 0 ? ` (${destinations.length})` : ""}
              </h2>
              {destinations.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  No destinations are linked to this route yet.
                </p>
              ) : (
                <ol className="mt-3 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {destinations.map((dest, index) => (
                    <li
                      key={dest.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/destinations/${dest.id}`}
                          className="font-medium text-gray-900 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                        >
                          {dest.name || "Unknown"}
                        </Link>
                        <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                          {[
                            dest.elevation != null
                              ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                              : null,
                            ...(Array.isArray(dest.features)
                              ? dest.features.map(titleize)
                              : []),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">
                        {index === 0
                          ? "Start"
                          : index === destinations.length - 1
                            ? "Finish"
                            : `Waypoint ${index + 1}`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {segments.length > 0 && (
              <section className="mt-10">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Segments ({segments.length})
                </h2>
                <ol className="mt-3 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {segments.map((segment) => (
                    <li
                      key={`${segment.id}-${segment.ordinal}`}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {segment.name || `Segment ${segment.ordinal + 1}`}
                        </div>
                        <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                          {[
                            formatDistanceMeters(segment.distance),
                            segment.gain != null
                              ? `${formatElevationMeters(segment.gain)} gain`
                              : null,
                            segment.direction === "reverse" ? "Reversed" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      {segment.route_count > 1 && (
                        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                          Shared by {segment.route_count} routes
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </main>

          <aside className="space-y-6">
            <SidePanel title="Stats">
              <dl className="space-y-2">
                <StatRow label="Shape" value={titleizeFirst(describeRouteShape(route.shape))} />
                <StatRow label="Distance" value={formatDistanceMeters(route.distance)} />
                <StatRow
                  label="Elevation gain"
                  value={formatElevationMeters(route.gain)}
                />
                <StatRow
                  label="Elevation loss"
                  value={formatElevationMeters(route.gain_loss)}
                />
                {guide.climbingDensityFeetPerMile != null && (
                  <StatRow
                    label="Climbing density"
                    value={`${Math.round(guide.climbingDensityFeetPerMile).toLocaleString()} ft/mi`}
                  />
                )}
                <StatRow label="Difficulty" value={guide.difficultyLabel} />
                <StatRow
                  label="Est. time"
                  value={formatDurationRange(
                    guide.estimatedHoursLow,
                    guide.estimatedHoursHigh
                  )}
                />
                <StatRow
                  label="Sessions"
                  value={sessionCount.toLocaleString("en-US")}
                />
              </dl>
            </SidePanel>

            {(directionsUrl || route.completion !== "none") && (
              <SidePanel title="Before you go">
                {route.completion !== "none" && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {describeCompletionMode(route.completion)}.
                  </p>
                )}
                {directionsUrl && (
                  <ul
                    className={`space-y-1.5 text-sm ${route.completion !== "none" ? "mt-2" : ""}`}
                  >
                    <li>
                      <a
                        href={directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Driving directions to {start?.name || "the trailhead"}
                      </a>
                    </li>
                  </ul>
                )}
              </SidePanel>
            )}

            {externalLinks.length > 0 && (
              <SidePanel title="External resources">
                <ul className="space-y-2 text-sm">
                  {externalLinks.map((link) => (
                    <li key={`${link.type}:${link.id}`}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {link.label}
                      </a>
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        {link.display}
                      </span>
                    </li>
                  ))}
                </ul>
              </SidePanel>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function buildAbout(
  name: string,
  route: RouteDetail,
  guide: ReturnType<typeof summarizeRouteGuide>,
  sessionCount: number
): string[] {
  const paragraphs: string[] = [];

  const shapeLabel = describeRouteShape(route.shape);
  const first = [
    `${name} is ${/^[aeiou]/i.test(shapeLabel) ? "an" : "a"} ${shapeLabel} route`,
    guide.distanceMiles != null
      ? ` covering ${guide.distanceMiles.toFixed(1)} miles`
      : "",
    guide.gainFeet != null
      ? ` with ${Math.round(guide.gainFeet).toLocaleString()} feet of elevation gain`
      : "",
    ".",
  ].join("");
  paragraphs.push(first);

  if (guide.estimatedHoursLow != null) {
    paragraphs.push(
      `It rates as ${guide.difficultyLabel.toLowerCase()} given its ${guide.difficultyReason}. Plan on ${formatDurationRange(guide.estimatedHoursLow, guide.estimatedHoursHigh)} of moving time.`
    );
  }

  if (sessionCount > 0) {
    paragraphs.push(
      `${sessionCount.toLocaleString("en-US")} recorded session${sessionCount === 1 ? " has" : "s have"} followed this route.`
    );
  }

  return paragraphs;
}

function titleizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
