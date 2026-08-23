import { notFound } from "next/navigation";
import {
  getRouteElevation,
  getRouteSegments,
  getRouteSessionCount,
  type RouteElevationPoint,
} from "../../../../lib/actions/routes";
// The same wrapped references `layout.tsx` uses — importing the raw
// actions here instead would read both rows a second time per request.
import {
  getRouteCached,
  getRouteDestinationsCached,
} from "../../../../lib/actions/cached-routes";
import { getNearbyDestinations } from "../../../../lib/actions/search";
import {
  buildRouteAbout,
  describeRouteShape,
  getRouteTraversalMetrics,
  parseExternalRouteLinks,
  shouldShowElevationLoss,
  summarizeRouteGuide,
} from "../../../../lib/route-guide";
import { formatDurationRangeFriendly } from "../../../../lib/format";
import { formatFeetValue, formatMilesValue } from "../../../../lib/destination-detail";
import { settled } from "../../../../lib/settled";
import { Breadcrumb } from "../../../../components/detail-sections";
import { AreaChips } from "../../../../components/area-chip";
import { PageHeader } from "../../../../components/ui/page-header";
import { DestinationMetaRow } from "../../../../components/destination/destination-meta-row";
import {
  Topline,
  type ToplineStat,
} from "../../../../components/ui/topline";
import { DestinationNearby } from "../../../../components/destination/destination-nearby";
import { RouteHero } from "../../../../components/route/route-hero";
import { RouteActions } from "../../../../components/route/route-actions";
import { RouteAbout } from "../../../../components/route/route-about";
import { RouteHistorySummary } from "../../../../components/route/route-history-summary";
import { RouteElevationProfile } from "../../../../components/route/route-elevation-profile";
import { RouteWaypoints } from "../../../../components/route/route-waypoints";
import { RouteSegments } from "../../../../components/route/route-segments";
import { RouteSource } from "../../../../components/route/route-source";
import { SectionHeading } from "../../../../components/ui/section-heading";

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const route = await getRouteCached(id);
  if (!route) notFound();

  const [destinations, segments, elevationPoints, sessionCount] = await Promise.all([
    settled(getRouteDestinationsCached(id), []),
    settled(getRouteSegments(id, { publicOnly: true }), []),
    settled(getRouteElevation(id, { publicOnly: true }), []),
    settled(getRouteSessionCount(id, { publicOnly: true }), 0),
  ]);

  const start = destinations[0];
  const onRouteIds = new Set(destinations.map((d) => d.id));
  const nearbyRaw =
    start && start.lat != null && start.lng != null
      ? await settled(getNearbyDestinations(start.lat, start.lng, 15000, 9), [])
      : [];
  const nearby = nearbyRaw.filter((n) => !onRouteIds.has(n.id)).slice(0, 6);

  const name = route.name || "Unnamed route";
  const guide = summarizeRouteGuide(route, segments.length);
  const traversal = getRouteTraversalMetrics(route);
  const profilePoints = buildProfilePoints(elevationPoints);
  const externalLinks = parseExternalRouteLinks(route.external_links);
  const shapeLabel = describeRouteShape(route.shape);
  const showLoss = shouldShowElevationLoss(traversal.lossMeters, route.shape);

  const directionsUrl =
    start && start.lat != null && start.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${start.lat},${start.lng}`
      : null;

  const aboutParagraphs = buildRouteAbout(route);

  const toplineStats: ToplineStat[] = [
    traversal.distanceMeters != null
      ? {
          key: "distance",
          value: formatMilesValue(traversal.distanceMeters) ?? "—",
          unit: "mi",
          label: "Distance",
        }
      : null,
    traversal.gainMeters != null
      ? {
          key: "gain",
          value: formatFeetValue(traversal.gainMeters) ?? "—",
          unit: "ft",
          label: "Elevation gain",
        }
      : null,
    showLoss && traversal.lossMeters != null
      ? {
          key: "loss",
          value: formatFeetValue(traversal.lossMeters) ?? "—",
          unit: "ft",
          label: "Elevation loss",
        }
      : null,
    guide.estimatedHoursLow != null
      ? {
          key: "time",
          value: formatDurationRangeFriendly(guide.estimatedHoursLow, guide.estimatedHoursHigh),
          label: "Est. time",
        }
      : null,
    sessionCount > 0
      ? {
          key: "sessions",
          value: sessionCount.toLocaleString("en-US"),
          label: sessionCount === 1 ? "Session" : "Sessions",
        }
      : null,
  ].filter((stat): stat is ToplineStat => stat !== null);

  const metaParts = [shapeLabel, guide.difficultyLabel].filter(
    (part): part is string => Boolean(part)
  );

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={<Breadcrumb current={name} />}
        title={name}
        meta={<DestinationMetaRow alert={null} parts={metaParts} />}
      />

      <AreaChips areas={route.areas} className="mt-4" />

      <RouteHero
        polyline6={route.polyline6}
        className="mt-8"
      />

      <RouteActions directionsUrl={directionsUrl} className="mt-8" />

      <Topline stats={toplineStats} className="mt-10" />

      <RouteHistorySummary routeId={id} className="mt-4" />

      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-12">
          <RouteAbout name={name} paragraphs={aboutParagraphs} />

          {profilePoints.length >= 2 ? (
            <section aria-labelledby="route-elevation-profile">
              <div className="flex items-baseline justify-between gap-4">
                <SectionHeading>
                  <span id="route-elevation-profile">Elevation profile</span>
                </SectionHeading>
                {guide.climbingDensityFeetPerMile != null ? (
                  <span className="font-mono-num tabular-nums text-xs text-muted">
                    {Math.round(guide.climbingDensityFeetPerMile).toLocaleString()} ft/mi avg
                  </span>
                ) : null}
              </div>
              <div className="mt-4">
                <RouteElevationProfile points={profilePoints} />
              </div>
            </section>
          ) : null}

          <RouteWaypoints destinations={destinations} />

          <RouteSegments segments={segments} />

          <RouteSource provenance={route.provenance} externalLinks={externalLinks} />
        </div>

        <aside className="space-y-12">
          <DestinationNearby destinations={nearby} />
        </aside>
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
      cumDist += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    result.push({ dist: cumDist, ele: points[i].elevation });
  }

  return result;
}

/** Haversine distance in meters between two lat/lng points */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
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
