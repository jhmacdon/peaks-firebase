import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDestinationReportsPageCached } from "../../../../../lib/actions/cached-reports";
import { formatShortDate, reportPreview } from "../../../../../lib/destination-detail";
import { catalogPageMetadata, catalogPageNumber, catalogPagePath, type CatalogSearchParams } from "../../../../../lib/catalog-seo";
import { Breadcrumb } from "../../../../../components/detail-sections";
import { PageHeader } from "../../../../../components/ui/page-header";
import { Button } from "../../../../../components/ui/button";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { CatalogPagination } from "../../../../../components/catalog-pagination";
import { WriteDestinationReport } from "../../../../../components/destination/write-destination-report";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<CatalogSearchParams>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await getDestinationReportsPageCached(id, catalogPageNumber((await searchParams).page));
  if (!result) return { title: "Destination not found", robots: { index: false } };
  return catalogPageMetadata({
    path: `/destinations/${encodeURIComponent(id)}/reports`,
    title: `${result.dest.name || "Destination"} trip reports`,
    description: `Read trip reports, trail conditions, route notes, and photos from visits to ${result.dest.name || "this destination"} on Peaks.`,
    page: result.page,
    noindex: result.totalCount === 0,
  });
}

export default async function DestinationReportsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const requestedPage = catalogPageNumber((await searchParams).page);
  const result = await getDestinationReportsPageCached(id, requestedPage);
  if (!result) notFound();
  const { dest, reports, totalCount, page } = result;
  const path = `/destinations/${encodeURIComponent(id)}/reports`;
  if (page !== requestedPage) redirect(catalogPagePath(path, page));
  const PAGE_SIZE = 20;

  const destName = dest.name || "Unnamed";

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          breadcrumb={
            <Breadcrumb
              current="Trip reports"
              crumbs={[
                { href: "/discover", label: "Discover" },
                { href: `/destinations/${id}`, label: destName },
              ]}
            />
          }
          title={`${destName} trip reports`}
          meta={
            totalCount > 0 ? (
              <span>
                {totalCount.toLocaleString("en-US")} trip report{totalCount === 1 ? "" : "s"}
              </span>
            ) : undefined
          }
          className="min-w-0"
        />
        <WriteDestinationReport destinationId={id} />
      </div>

      {reports.length === 0 ? (
        <EmptyState
          className="mt-10"
          title={totalCount > 0 ? "No reports on this page" : "No trip reports yet"}
          description={totalCount > 0 ? "Return to the first page to read the latest reports." : undefined}
        >{totalCount > 0 && <Button href={`/destinations/${id}/reports`} className="mt-4">First page</Button>}</EmptyState>
      ) : (
        // Quiet rows, not cards — the same shape as the flagship page's own
        // trip-reports section (components/destination/destination-reports.tsx),
        // just without its report cap.
        <ul className="mt-10 space-y-6">
          {reports.map((report) => {
            const preview = reportPreview(report.blocks);
            const photoCount = report.blocks.filter((block) => block.type === "photo").length;
            return (
              <li key={report.id}>
                <Link href={`/reports/${report.id}`} className="group block">
                  <span className="block text-[17px] font-medium text-ink group-hover:underline">
                    {report.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted">
                    {report.userName} · {formatShortDate(report.date)}
                    {photoCount > 0 ? (
                      <>
                        {" · "}
                        <span className="font-mono-num tabular-nums">{photoCount}</span>
                        {` photo${photoCount === 1 ? "" : "s"}`}
                      </>
                    ) : null}
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
      )}
      <CatalogPagination page={page} pageCount={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))} href={(nextPage) => catalogPagePath(path, nextPage)} />
    </div>
  );
}
