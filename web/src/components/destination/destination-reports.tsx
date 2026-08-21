import Link from "next/link";
import { formatShortDate, reportPreview } from "../../lib/destination-detail";
import type { TripReport } from "../../lib/actions/trip-reports";
import { SectionHeading } from "../ui/section-heading";

/** What people found when they got here. Quiet rows: title, byline, two
 * clamped lines of the report itself. */
export function DestinationReports({
  destinationId,
  reports,
  totalCount,
  className = "",
}: {
  destinationId: string;
  reports: TripReport[];
  totalCount: number;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="destination-reports">
      {/* No count in the heading — the topline row above already carries
          "N trip reports", and the page states each number once. */}
      <SectionHeading>
        <span id="destination-reports">Trip reports</span>
      </SectionHeading>

      {reports.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No trip reports yet. Been here?{" "}
          <Link
            href={`/reports/new?dest=${destinationId}`}
            className="font-medium text-accent-text hover:underline"
          >
            Write the first one
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-5">
            {reports.map((report) => {
              const preview = reportPreview(report.blocks);
              return (
                <li key={report.id}>
                  <Link href={`/reports/${report.id}`} className="group block">
                    <span className="block text-base font-medium text-ink group-hover:underline">
                      {report.title}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {report.userName} · {formatShortDate(report.date)}
                    </span>
                  </Link>
                  {preview ? (
                    <p className="mt-1.5 line-clamp-2 max-w-[68ch] text-sm leading-[1.6] text-ink-2">
                      {preview}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {totalCount > reports.length ? (
            <Link
              href={`/destinations/${destinationId}/reports`}
              className="mt-5 inline-block text-sm font-medium text-accent-text hover:underline"
            >
              All {totalCount.toLocaleString("en-US")} trip reports →
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}
