import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDestination, type DestinationDetail } from "../../../../lib/actions/destinations";
// The same wrapped reference `layout.tsx` uses — importing the raw action
// here instead would read the report row a second time per request.
import { getTripReportCached } from "../../../../lib/actions/cached-reports";
import { formatDate } from "../../../../lib/format";
import { formatFeetValue } from "../../../../lib/destination-detail";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import { DestinationMetaRow } from "../../../../components/destination/destination-meta-row";
import { ReportEditLink } from "../../../../components/report/report-edit-link";

export default async function TripReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await getTripReportCached(id);
  if (!report) notFound();

  // Each lookup catches its own failure — a single missing/errored
  // destination drops out of the chip row rather than taking the whole
  // report page down with it.
  const destinationRows = await Promise.all(
    report.destinations.map(async (destId) => {
      try {
        return await getDestination(destId);
      } catch {
        return null;
      }
    })
  );
  const destinations = destinationRows.filter(
    (dest): dest is DestinationDetail => dest !== null
  );

  return (
    <div className="mx-auto max-w-[760px] px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          breadcrumb={<Breadcrumb current={report.title} />}
          title={report.title}
          meta={<DestinationMetaRow alert={null} parts={[report.userName, formatDate(report.date)]} />}
          className="min-w-0"
        />
        <ReportEditLink reportId={report.id} />
      </div>

      {destinations.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
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
                  <span className="font-mono-num tabular-nums text-faint">{elevation} ft</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}

      <div className="mt-10 max-w-[68ch] space-y-6">
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
                    alt={block.caption || "Trip photo"}
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
    </div>
  );
}
