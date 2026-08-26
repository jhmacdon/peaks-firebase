import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDestination, type DestinationDetail } from "../../../../lib/actions/destinations";
// The same wrapped reference `layout.tsx` uses — importing the raw action
// here instead would read the report row a second time per request.
import { getTripReportCached } from "../../../../lib/actions/cached-reports";
import { getRouteCached } from "../../../../lib/actions/cached-routes";
import { formatDate } from "../../../../lib/format";
import { formatFeetValue } from "../../../../lib/destination-detail";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import { DestinationMetaRow } from "../../../../components/destination/destination-meta-row";
import { ReportEditLink } from "../../../../components/report/report-edit-link";
import ReportMapEmbed, {
  type ReportMapDestination,
  type ReportMapRoute,
} from "../../../../components/report/report-map-embed";
import { ShareLinkButton } from "../../../../components/share-link-button";
import { settled } from "../../../../lib/settled";

export default async function TripReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await getTripReportCached(id);
  if (!report) notFound();

  // A stale destination or route link must not take the report down. Route
  // reads also enforce the public Peaks catalog filter, so the map never
  // reaches through to the source activity's private GPS track.
  const [destinationRows, routeRows] = await Promise.all([
    Promise.all(
      report.destinations.map((destId) =>
        settled(getDestination(destId), null)
      )
    ),
    Promise.all(
      report.routes.map((routeId) => settled(getRouteCached(routeId), null))
    ),
  ]);
  const destinations = destinationRows.filter(
    (dest): dest is DestinationDetail => dest !== null
  );
  const mapDestinations: ReportMapDestination[] = destinations.flatMap((dest) =>
    dest.lat != null && dest.lng != null
      ? [
          {
            id: dest.id,
            name: dest.name,
            elevation: dest.elevation,
            lat: dest.lat,
            lng: dest.lng,
            features: dest.features,
            countryCode: dest.country_code,
          },
        ]
      : []
  );
  const mapRoutes: ReportMapRoute[] = routeRows.flatMap((route) =>
    route?.polyline6
      ? [
          {
            id: route.id,
            name: route.name,
            polyline6: route.polyline6,
            hasOsmGeometry:
              route.provenance?.contains_osm_geometry === true,
          },
        ]
      : []
  );
  const hasMap = mapDestinations.length > 0 || mapRoutes.length > 0;
  const excerpt =
    report.blocks
      .find((block) => block.type === "text")
      ?.content.replace(/\s+/g, " ")
      .trim()
      .slice(0, 220) ?? "";
  const photoContext =
    destinations.map((destination) => destination.name).filter(Boolean).join(" and ") ||
    report.title;

  return (
    <>
      {hasMap ? (
        <section className="mx-auto max-w-[1280px] sm:px-6 sm:pt-6" aria-labelledby="report-title">
          <div className="relative">
            <div className="relative isolate overflow-hidden bg-fill sm:rounded-media">
              <ReportMapEmbed
                destinations={mapDestinations}
                routes={mapRoutes}
                reportTitle={report.title}
                byline={`${report.userName} · ${formatDate(report.date)}`}
                excerpt={excerpt}
                className="h-[42svh] min-h-[320px] max-h-[390px] sm:h-[clamp(430px,42vw,560px)] sm:max-h-none"
              />
            </div>

            <header className="shadow-float relative z-[800] mx-4 -mt-6 rounded-media border border-border bg-page p-5 sm:absolute sm:bottom-6 sm:left-6 sm:mx-0 sm:mt-0 sm:w-[520px] sm:max-w-[calc(100%_-_3rem)] sm:border-white/15 sm:bg-[#102424]/95 sm:p-6 sm:text-white sm:backdrop-blur-md">
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted sm:text-white/65">
                <Link href="/discover" className="hover:underline">
                  Discover
                </Link>
                <span aria-hidden="true">›</span>
                <span>Trip report</span>
              </nav>
              <h1
                id="report-title"
                className="mt-3 font-display text-[32px] font-[680] leading-[1.06] tracking-[-0.015em] text-ink sm:text-[42px] sm:text-white"
              >
                {report.title}
              </h1>
              <p className="mt-2 text-sm text-ink-2 sm:text-white/75">
                {report.userName} · {formatDate(report.date)}
              </p>

              {destinations.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2" aria-label="Places in this report">
                  {destinations.map((dest) => {
                    const elevation = formatFeetValue(dest.elevation);
                    return (
                      <Link
                        key={dest.id}
                        href={`/destinations/${dest.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-page/85 px-2.5 py-1 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-2 sm:border-white/20 sm:bg-black/20 sm:text-white sm:hover:border-white/60"
                      >
                        <span>{dest.name || "Unnamed"}</span>
                        {elevation ? (
                          <span className="font-mono-num tabular-nums text-faint sm:text-white/60">
                            {elevation} ft
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <ReportEditLink reportId={report.id} />
                <ShareLinkButton
                  url={`/reports/${encodeURIComponent(report.id)}`}
                  title={report.title}
                  size="sm"
                />
              </div>
            </header>
          </div>
        </section>
      ) : (
        <div className="mx-auto max-w-[760px] px-6 pt-8">
          <PageHeader
            breadcrumb={<Breadcrumb current={report.title} />}
            title={report.title}
            meta={
              <DestinationMetaRow
                alert={null}
                parts={[report.userName, formatDate(report.date)]}
              />
            }
            actions={
              <>
                <ReportEditLink reportId={report.id} />
                <ShareLinkButton
                  url={`/reports/${encodeURIComponent(report.id)}`}
                  title={report.title}
                />
              </>
            }
          />
        </div>
      )}

      <article className="mx-auto max-w-[760px] px-6 pb-8 pt-10 sm:pt-12">
        {!hasMap && destinations.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {destinations.map((dest) => {
              const elevation = formatFeetValue(dest.elevation);
              return (
                <Link
                  key={dest.id}
                  href={`/destinations/${dest.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-2"
                >
                  <span>{dest.name || "Unnamed"}</span>
                  {elevation ? (
                    <span className="font-mono-num tabular-nums text-faint">
                      {elevation} ft
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}

      <div className={`${hasMap ? "mt-2" : "mt-10"} max-w-[68ch] space-y-6`}>
        {report.blocks.map((block, index) => {
          if (block.type === "text") {
            return (
              <div key={index} className="space-y-4 text-[17px] leading-[1.7] text-ink-2">
                {block.content.split("\n").filter(Boolean).map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
              </div>
            );
          }

          if (block.type === "photo") {
            return (
              <figure key={index}>
                {/* `fill` rather than literal width/height: trip photos
                    have no stored dimensions, and declaring a guessed
                    width/height pair would stretch a portrait phone photo
                    to whatever aspect that guess implied. A fixed-ratio
                    container with `object-cover` gets the same next/image
                    wins (responsive, lazy, no CLS) without distorting the
                    source photo. */}
                <div className="rounded-media bg-fill relative aspect-[4/3] w-full overflow-hidden">
                  <Image
                    src={block.content}
                    alt={block.caption || `${photoContext} trip photo`}
                    fill
                    sizes="(min-width: 760px) 700px, 100vw"
                    className="object-cover"
                    loading="lazy"
                  />
                </div>
                {block.caption ? (
                  <figcaption className="mt-2 text-center text-sm text-muted">
                    {block.caption}
                  </figcaption>
                ) : null}
              </figure>
            );
          }

          return null;
        })}
      </div>

      {destinations.length > 0 ? (
        <div className="mt-12 border-t border-hairline pt-8">
          <p className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
            More reports for these destinations
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {destinations.map((dest) => (
              <Link
                key={dest.id}
                href={`/destinations/${dest.id}/reports`}
                className="text-sm font-medium text-accent-text hover:underline"
              >
                {dest.name || "Unnamed"} reports
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      </article>
    </>
  );
}
