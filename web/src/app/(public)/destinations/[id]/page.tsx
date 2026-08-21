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
import { DestinationAbout } from "../../../../components/destination/destination-about";
import { DestinationActions } from "../../../../components/destination/destination-actions";
import { DestinationActivity } from "../../../../components/destination/destination-activity";
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

  const [routes, lists, sessionCount, tripReportCount, tripReports, nearbyRaw, weather] =
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
    ]);

  const nearby = nearbyRaw.filter((n) => n.id !== id).slice(0, 6);

  const name = dest.name || "Unnamed";
  const regionLabel = formatRegion(dest.state_code, dest.country_code);
  const typeLabel = describeDestinationType(dest.type, dest.features);
  const guide = buildDestinationGuide(dest, regionLabel, sessionCount);
  const elevationValue = formatFeetValue(dest.elevation);
  const prominenceValue = formatFeetValue(dest.prominence);
  const months = monthlyVisitCounts(dest.averages);
  const facilities = amenityRows(dest.amenities);
  // A destination's amenities are campsite-shaped or trailhead-shaped, never
  // both, so exactly one of these two lists ever has rows.
  const trailheadFacts = trailheadAmenityRows(dest.amenities);
  const trailheadCredits = amenityCredits(trailheadFacts);

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
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={<Breadcrumb current={name} />}
        title={name}
        meta={
          <DestinationMetaRow
            // Closures and seasonal alerts belong in this slot when Peaks
            // has that data. It has none today, so nothing renders.
            alert={null}
            parts={[typeLabel, regionLabel]}
          />
        }
      />

      <AreaChips areas={dest.areas} className="mt-4" />

      <DestinationHero
        name={name}
        photos={photos}
        lat={dest.lat}
        lng={dest.lng}
        boundary={dest.boundary}
        elevationValue={elevationInHero ? elevationValue : null}
        className="mt-8"
      />

      {mapIsHero ? (
        <DestinationMapLinks lat={dest.lat!} lng={dest.lng!} className="mt-3" />
      ) : null}

      <DestinationActions
        destinationId={id}
        name={dest.name}
        directionsUrl={directionsUrl}
        className="mt-8"
      />

      <Topline stats={toplineStats} className="mt-10" />

      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-12">
          <DestinationActivity destinationId={id} />

          <DestinationAbout
            name={name}
            body={dest.description || guide.headline}
            sourceName={dest.description ? dest.description_source_name : null}
            sourceUrl={dest.description ? dest.description_source_url : null}
            sourceLicense={dest.description ? dest.description_source_license : null}
          />

          <DestinationPlanning
            notes={guide.paragraphs}
            facilities={facilities}
            forecastUrl={forecastUrl}
          />

          <DestinationTrailheads rows={trailheadFacts} credits={trailheadCredits} />

          {weather ? (
            <DestinationWeather days={weather.days} forecastUrl={forecastUrl} />
          ) : null}

          {months ? <DestinationSeasonality counts={months} /> : null}

          {/* Skipped only when the hero already IS the live map — see
              DestinationHero. Without coordinates the section still renders
              and says so, rather than the page quietly losing a heading. */}
          {mapIsHero ? null : (
            <DestinationMapSection
              name={dest.name}
              lat={dest.lat}
              lng={dest.lng}
              boundary={dest.boundary}
            />
          )}

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
  );
}
