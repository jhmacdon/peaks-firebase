import { ActivityPhotoGroups } from "../../../../components/activity-photo-groups";
import { getActivityPhotoGroups } from "../../../../lib/actions/activity-photos";
import { DetailSectionNav } from "../../../../components/detail-section-nav";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import {
  getDestinationRoutes,
  getDestinationLists,
} from "../../../../lib/actions/destinations";
// The same wrapped references `layout.tsx` uses — importing the raw actions
// here instead would read both rows a second time per request.
import {
  getDestinationCached,
  getDestinationSessionCountCached,
} from "../../../../lib/actions/cached-destinations";
import { getNearbyDestinations } from "../../../../lib/actions/search";
import { getDestinationWeatherCached } from "../../../../lib/actions/cached-weather";
import {
  getTripReportsForDestination,
  getTripReportCountForDestination,
} from "../../../../lib/actions/trip-reports";
import {
  buildDestinationGuide,
  describeDestinationType,
  describeSessionNoun,
  formatFeetValue,
  monthlyVisitCounts,
  amenityCredits,
  amenityRows,
  trailheadAmenityRows,
} from "../../../../lib/destination-detail";
import { formatRegion } from "../../../../lib/regions";
import { Breadcrumb } from "../../../../components/detail-sections";
import { AreaChips } from "../../../../components/area-chip";
import { PageHeader } from "../../../../components/ui/page-header";
import { FireLookoutBadge } from "../../../../components/fire-lookout-badge";
import { DestinationAbout } from "../../../../components/destination/destination-about";
import { DestinationActions } from "../../../../components/destination/destination-actions";
import { DestinationActivity, DestinationActivityProvider, DestinationSessions } from "../../../../components/destination/destination-activity";
import { DestinationHero } from "../../../../components/destination/destination-hero";
import { DestinationLists } from "../../../../components/destination/destination-lists";
import { DestinationMapLinks } from "../../../../components/destination/destination-map-links";
import { DestinationMapSection } from "../../../../components/destination/destination-map-section";
import { DestinationMetaRow } from "../../../../components/destination/destination-meta-row";
import { DestinationNearby } from "../../../../components/destination/destination-nearby";
import { DestinationPlanning } from "../../../../components/destination/destination-planning";
import { DestinationReports } from "../../../../components/destination/destination-reports";
import { DestinationRoutes } from "../../../../components/destination/destination-routes";
import { DestinationSeasonality } from "../../../../components/destination/destination-seasonality";
import { DestinationTrailheads } from "../../../../components/destination/destination-trailheads";
import { DestinationWeather } from "../../../../components/destination/destination-weather";
import { DestinationExternalLinks } from "../../../../components/destination/destination-external-links";
import { DestinationRecreationGov } from "../../../../components/destination/destination-recreation-gov";
import {
  parseDestinationExternalLinks,
  partitionDestinationExternalLinks,
} from "../../../../lib/external-links";
import {
  Topline,
  type ToplineStat,
} from "../../../../components/ui/topline";

// The catalog page is a server component: this one template renders ~70,000
// pages, and every one of them used to arrive as a "Loading…" shell that
// only filled in after the browser round-tripped six server actions. The
// page body now ships in the HTML. Three things still depend on the browser
// and stay client islands — saving a place, personal activity, and the
// Leaflet map.

/** A missing route list or a slow Firestore read shouldn't take a catalog
 * page down with it; the section it feeds simply doesn't render. The
 * destination lookup itself is deliberately NOT wrapped — without it there
 * is no page.
 *
 * `noStore()` on the failure path is what keeps that graceful degradation
 * from turning into an hour of lying. The segment is cached for an hour
 * (see layout.tsx), so without this a single transient database blip would
 * pin "No routes are linked to this destination yet." onto a peak that has
 * five, for the next 3,600 seconds. Marking the render dynamic keeps the
 * thin version out of the cache, and the next request tries again. */
async function settled<T>(task: Promise<T>, fallback: T): Promise<T> {
  try {
    return await task;
  } catch {
    noStore();
    return fallback;
  }
}

export default async function DestinationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dest = await getDestinationCached(id);
  if (!dest) notFound();

  const hasCoords = dest.lat != null && dest.lng != null;

  const [routes, lists, sessionCount, tripReportCount, tripReports, nearbyRaw, weather, photoGroups] =
    await Promise.all([
      settled(getDestinationRoutes(id, { publicOnly: true }), []),
      settled(getDestinationLists(id), []),
      settled(getDestinationSessionCountCached(id), 0),
      settled(getTripReportCountForDestination(id), 0),
      settled(getTripReportsForDestination(id, 5), []),
      hasCoords
        ? settled(getNearbyDestinations(dest.lat!, dest.lng!, 15000, 7), [])
        : Promise.resolve([]),
      settled(getDestinationWeatherCached(id), null),
      getActivityPhotoGroups({ destinationId: id }),
    ]);

  const nearby = nearbyRaw.filter((n) => n.id !== id).slice(0, 6);

  const name = dest.name || "Unnamed";
  const regionLabel = formatRegion(dest.state_code, dest.country_code);
  const typeLabel = describeDestinationType(dest.type, dest.features);
  const hasFireLookout = dest.features.includes("fire-lookout");
  const guide = buildDestinationGuide(dest, regionLabel, sessionCount);
  const elevationValue = formatFeetValue(dest.elevation);
  const prominenceValue = formatFeetValue(dest.prominence);
  const months = monthlyVisitCounts(dest.averages);
  const facilities = amenityRows(dest.amenities);
  // A destination's amenities are campsite-shaped or trailhead-shaped, never
  // both, so exactly one of these two lists ever has rows.
  const trailheadFacts = trailheadAmenityRows(dest.amenities);
  const trailheadCredits = amenityCredits(trailheadFacts);
  const externalLinks = parseDestinationExternalLinks(dest.external_links, dest.external_ids);
  const destinationLinks = partitionDestinationExternalLinks(externalLinks);

  const directionsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`
    : null;
  const forecastUrl =
    hasCoords && dest.country_code === "US"
      ? `https://forecast.weather.gov/MapClick.php?lat=${dest.lat}&lon=${dest.lng}`
      : null;

  const photos = dest.hero_image
    ? [
        {
          url: dest.hero_image,
          credit: dest.hero_image_attribution,
          creditUrl: dest.hero_image_attribution_url,
          focalX: dest.hero_image_focal_x,
          focalY: dest.hero_image_focal_y,
        },
      ]
    : [];

  // With no photo the hero is the map, and it carries the elevation on its
  // scrim — so elevation drops out of the topline row rather than being
  // printed twice (Task 1's rule: every stat once per page).
  const mapIsHero = photos.length === 0 && hasCoords;
  const elevationInHero = mapIsHero && elevationValue != null;

  const toplineStats: ToplineStat[] = [
    !elevationInHero && elevationValue
      ? { key: "elevation", value: elevationValue, unit: "ft", label: "Elevation" }
      : null,
    prominenceValue
      ? { key: "prominence", value: prominenceValue, unit: "ft", label: "Prominence" }
      : null,
    sessionCount > 0
      ? {
          key: "sessions",
          value: sessionCount.toLocaleString("en-US"),
          label: describeSessionNoun(dest.features),
        }
      : null,
    routes.length > 0
      ? {
          key: "routes",
          value: routes.length.toLocaleString("en-US"),
          label: routes.length === 1 ? "Route" : "Routes",
        }
      : null,
    tripReportCount > 0
      ? {
          key: "reports",
          value: tripReportCount.toLocaleString("en-US"),
          label: tripReportCount === 1 ? "Trip report" : "Trip reports",
        }
      : null,
  ].filter((stat): stat is ToplineStat => stat !== null);

  return (
    <DestinationActivityProvider destinationId={id}>
    <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<Breadcrumb current={name} />}
        title={name}
        meta={
          <>
            {hasFireLookout ? <FireLookoutBadge /> : null}
            <DestinationMetaRow
              // Closures and seasonal alerts belong in this slot when Peaks
              // has that data. It has none today, so nothing renders.
              alert={null}
              parts={[
                hasFireLookout && typeLabel === "Fire lookout" ? null : typeLabel,
                regionLabel,
              ]}
            />
          </>
        }
      />

      <DestinationActivity className="mt-6" />

      <AreaChips areas={dest.areas} className="mt-4" />

      <DestinationActions destinationId={id} name={dest.name} directionsUrl={directionsUrl} className="mt-5" />
      <DetailSectionNav sections={[
        { id: "destination-about", label: "Overview" },
        { id: "destination-facts", label: "Facts" },
        ...(photoGroups.length ? [{ id: "destination-photos", label: "Photos" }] : []),
        { id: "destination-routes", label: "Routes" },
        ...(tripReportCount ? [{ id: "destination-reports", label: "Trip reports" }] : []),
      ]} />
      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-12">
          <DestinationAbout
            name={name}
            body={dest.description || guide.headline}
            sourceName={dest.description ? dest.description_source_name : null}
            sourceUrl={dest.description ? dest.description_source_url : null}
            sourceLicense={dest.description ? dest.description_source_license : null}
          />

          <section id="destination-facts" className="scroll-mt-24" aria-label="Catalog facts">
            <Topline stats={toplineStats} />
          </section>
          <DestinationPlanning
            context={{
              routeCount: routes.length,
              isTrailhead: dest.features.includes("trailhead"),
              accessFacts: trailheadFacts,
              sources: [
                ...externalLinks.filter((link) => link.type === "nps" || link.type === "usfs").map((link) => ({ name: link.type === "nps" ? "National Park Service" : "US Forest Service", url: link.href })),
                ...trailheadCredits,
                ...(dest.description_source_name && dest.description_source_url ? [{ name: dest.description_source_name, url: dest.description_source_url }] : []),
                ...externalLinks.filter((link) => ["wta", "mountaineers", "alltrails", "summitpost"].includes(link.type)).map((link) => ({ name: link.label.replace(/^View on /, ""), url: link.href })),
              ],
            }}
            facilities={facilities}
            forecastUrl={forecastUrl}
          />
          <DestinationRecreationGov link={destinationLinks.recreationGov} />
          <DestinationExternalLinks links={destinationLinks.other} />
          <DestinationTrailheads rows={trailheadFacts} credits={trailheadCredits} />

          {weather ? (
            <DestinationWeather days={weather.days} forecastUrl={forecastUrl} locationName={name} elevationFeet={elevationValue} />
          ) : null}

          {months ? <DestinationSeasonality counts={months} /> : null}

          <DestinationHero name={name} photos={photos} lat={dest.lat} lng={dest.lng} boundary={dest.boundary} elevationValue={elevationInHero ? elevationValue : null} />
          {mapIsHero ? <DestinationMapLinks lat={dest.lat!} lng={dest.lng!} /> : (
            <DestinationMapSection name={dest.name} lat={dest.lat} lng={dest.lng} boundary={dest.boundary} />
          )}
          <ActivityPhotoGroups groups={photoGroups} id="destination-photos" />
          <DestinationSessions />

          <DestinationRoutes routes={routes} />

          <DestinationReports
            destinationId={id}
            reports={tripReports}
            totalCount={tripReportCount}
          />
        </div>

        <aside className="space-y-12">
          <DestinationNearby destinations={nearby} />
          <DestinationLists lists={lists} />
        </aside>
      </div>
    </div>
    </DestinationActivityProvider>
  );
}
