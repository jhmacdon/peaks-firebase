import Link from "next/link";
import type { DestinationDetail } from "../../lib/actions/destinations";
import { getDestinationLists } from "../../lib/actions/destinations";
import { getNearbyDestinations } from "../../lib/actions/search";
import { getTripReportCountForDestination, getTripReportsForDestination } from "../../lib/actions/trip-reports";
import { getActivityPhotoGroups } from "../../lib/actions/activity-photos";
import {
  getGlacierMountainById,
  getGlacierRoutes,
  getMountainGlaciers,
} from "../../lib/actions/cached-glaciers";
import {
  feetValue,
  formatAreaMi2,
  formatPercentChange,
  glacierAreaChange,
  glacierFaqs,
  glacierLeadParagraph,
  glacierMountainPath,
  isCombinedHistory,
  kindWord,
  measuredHistory,
  type GlacierFacts,
} from "../../lib/glaciers";
import { formatRegion, subdivisionName } from "../../lib/regions";
import { settled } from "../../lib/settled";
import { ActivityPhotoGroups } from "../activity-photo-groups";
import { AreaChips } from "../area-chip";
import { Breadcrumb } from "../detail-sections";
import { DetailSectionNav } from "../detail-section-nav";
import { DestinationActions } from "../destination/destination-actions";
import { DestinationActivity, DestinationActivityProvider } from "../destination/destination-activity";
import { DestinationHero } from "../destination/destination-hero";
import { DestinationLists } from "../destination/destination-lists";
import { DestinationMapLinks } from "../destination/destination-map-links";
import { DestinationNearby } from "../destination/destination-nearby";
import { DestinationReports } from "../destination/destination-reports";
import { PageHeader } from "../ui/page-header";
import { SectionHeading } from "../ui/section-heading";
import { Topline, type ToplineStat } from "../ui/topline";
import { GlacierAreaHistory } from "./glacier-area-history";
import {
  GlacierFactList,
  GlacierFaqList,
  GlacierRoutes,
  GlacierSiblings,
  GlacierSources,
} from "./glacier-sections";

/** The glacier variant of the destination page. Same skeleton as the
 * catalog page — title, personal activity, credited copy, facts, map,
 * photos, routes (design-tokens.md, "Layout") — with the measured glacier
 * facts in place of the summit's elevation and prominence, which a glacier
 * row doesn't carry. Every figure comes from destination_glacier_facts;
 * nothing is estimated on the page. */
export async function GlacierDetailPage({
  dest,
  facts,
}: {
  dest: DestinationDetail;
  facts: GlacierFacts;
}) {
  const id = dest.id;
  const hasCoords = dest.lat != null && dest.lng != null;

  const [routes, siblings, mountain, lists, nearbyRaw, tripReportCount, tripReports, photoGroups] = await Promise.all([
    settled(getGlacierRoutes(id), []),
    settled(getMountainGlaciers(facts.parent.id, false), []),
    settled(getGlacierMountainById(facts.parent.id), null),
    settled(getDestinationLists(id), []),
    hasCoords ? settled(getNearbyDestinations(dest.lat!, dest.lng!, 12000, 14), []) : Promise.resolve([]),
    settled(getTripReportCountForDestination(id), 0),
    settled(getTripReportsForDestination(id, 5), []),
    getActivityPhotoGroups({ destinationId: id }),
  ]);

  const siblingIds = new Set(siblings.map((g) => g.id));
  const nearby = nearbyRaw.filter((n) => n.id !== id && !siblingIds.has(n.id)).slice(0, 6);
  const hubHref = mountain ? glacierMountainPath(mountain) : null;
  const regionLabel = formatRegion(dest.state_code, dest.country_code);
  const stateName = subdivisionName(dest.country_code, dest.state_code);
  const kind = kindWord(facts.kind);
  const lead = glacierLeadParagraph(facts, stateName);
  const faqs = glacierFaqs(facts, stateName, routes);
  const change = glacierAreaChange(facts);
  const hasHistory = measuredHistory(facts.area_history).length >= 2;
  const credited =
    dest.description && dest.description_source_name && dest.description_source_url && dest.description_source_license
      ? dest.description
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

  const toplineStats: ToplineStat[] = [
    facts.area_km2 != null
      ? { key: "area", value: formatAreaMi2(facts.area_km2).replace(" mi²", ""), unit: "mi²", label: facts.observed_year ? `Area, ${facts.observed_year}` : "Area" }
      : null,
    facts.head_elevation_m != null ? { key: "top", value: feetValue(facts.head_elevation_m), unit: "ft", label: "Top" } : null,
    facts.terminus_elevation_m != null
      ? { key: "terminus", value: feetValue(facts.terminus_elevation_m), unit: "ft", label: "Terminus" }
      : null,
    change
      ? {
          key: "change",
          value: formatPercentChange(change.percent),
          label: `Area since ${change.fromYear}${isCombinedHistory(facts) ? " (combined)" : ""}`,
        }
      : null,
    routes.length > 0
      ? { key: "routes", value: routes.length.toLocaleString("en-US"), label: routes.length === 1 ? "Route across" : "Routes across" }
      : null,
  ].filter((stat): stat is ToplineStat => stat !== null);

  const crumbs = [
    { href: "/glaciers", label: "Glaciers" },
    ...(hubHref ? [{ href: hubHref, label: facts.parent.name }] : []),
  ];

  return (
    <DestinationActivityProvider destinationId={id}>
      <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-6">
        <PageHeader
          breadcrumb={<Breadcrumb current={facts.name} crumbs={crumbs} />}
          title={facts.name}
          meta={
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] tracking-[0.01em] text-muted">
              <span>
                {kind} on{" "}
                <Link href={`/destinations/${facts.parent.id}`} className="text-accent-text hover:underline">
                  {facts.parent.name}
                </Link>
              </span>
              {regionLabel ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{regionLabel}</span>
                </>
              ) : null}
            </p>
          }
        />

        <DestinationActivity className="mt-6" />
        <AreaChips areas={dest.areas} className="mt-4" />
        <DestinationActions destinationId={id} name={facts.name} directionsUrl={null} className="mt-5" />

        <DetailSectionNav
          sections={[
            { id: "glacier-about", label: "Overview" },
            { id: "glacier-facts", label: "Facts" },
            ...(hasCoords ? [{ id: "glacier-map", label: "Map" }] : []),
            ...(hasHistory ? [{ id: "glacier-history", label: "History" }] : []),
            { id: "glacier-routes", label: "Routes" },
            ...(faqs.length ? [{ id: "glacier-faq", label: "Questions" }] : []),
            { id: "glacier-sources", label: "Sources" },
          ]}
        />

        <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-12">
            <section id="glacier-about" className="scroll-mt-24" aria-labelledby="glacier-about-heading">
              <SectionHeading>
                <span id="glacier-about-heading">About {facts.name}</span>
              </SectionHeading>
              {credited ? (
                <>
                  <p className="mt-4 max-w-[68ch] text-base leading-[1.7] text-ink-2">{credited}</p>
                  <p className="mt-2 text-[13px] text-muted">
                    Source:{" "}
                    <a href={dest.description_source_url!} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-2">
                      {dest.description_source_name}
                    </a>
                    {` · ${dest.description_source_license}`}
                  </p>
                </>
              ) : null}
              <p className={`${credited ? "mt-5" : "mt-4"} max-w-[68ch] text-base leading-[1.7] text-ink-2`}>{lead}</p>
              <Topline stats={toplineStats} className="mt-8" />
            </section>

            <GlacierFactList facts={facts} />

            {hasCoords ? (
              <section id="glacier-map" className="scroll-mt-24" aria-labelledby="glacier-map-heading">
                <SectionHeading eyebrow={facts.boundary ? "Mapped outline" : undefined}>
                  <span id="glacier-map-heading">Map</span>
                </SectionHeading>
                <DestinationHero
                  name={facts.name}
                  photos={photos}
                  lat={dest.lat}
                  lng={dest.lng}
                  boundary={facts.boundary ?? dest.boundary}
                  elevationValue={null}
                  basemap="satellite"
                  className="mt-4"
                />
                <DestinationMapLinks lat={dest.lat!} lng={dest.lng!} className="mt-3" />
              </section>
            ) : null}

            <GlacierAreaHistory facts={facts} />

            <GlacierRoutes name={facts.name} kind={facts.kind} routes={routes} />

            <ActivityPhotoGroups groups={photoGroups} id="glacier-photos" />

            {tripReportCount > 0 ? (
              <DestinationReports destinationId={id} reports={tripReports} totalCount={tripReportCount} />
            ) : null}

            <GlacierFaqList items={faqs} />

            <GlacierSources facts={facts} />
          </div>

          <aside className="space-y-12">
            <GlacierSiblings currentId={id} parentName={facts.parent.name} hubHref={hubHref} glaciers={siblings} />
            <DestinationNearby destinations={nearby} />
            <DestinationLists lists={lists} />
          </aside>
        </div>
      </div>
    </DestinationActivityProvider>
  );
}
