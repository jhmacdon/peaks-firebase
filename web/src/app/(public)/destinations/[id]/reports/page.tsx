"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getTripReportCountForDestination, getTripReportsForDestination } from "../../../../../lib/actions/trip-reports";
import { getDestination, type DestinationDetail } from "../../../../../lib/actions/destinations";
import { formatShortDate, reportPreview } from "../../../../../lib/destination-detail";
import type { TripReport } from "../../../../../lib/actions/trip-reports";
import { useAuth } from "../../../../../lib/auth-context";
import { LOADING_LABEL } from "../../../../../lib/constants";
import { Breadcrumb } from "../../../../../components/detail-sections";
import { PageHeader } from "../../../../../components/ui/page-header";
import { Button } from "../../../../../components/ui/button";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { CatalogPagination } from "../../../../../components/catalog-pagination";

const PAGE_SIZE = 20;

export default function DestinationReportsPage() {
  return <Suspense fallback={<EmptyState>{LOADING_LABEL}</EmptyState>}><DestinationReportsContent /></Suspense>;
}

function DestinationReportsContent() {
  const params = useParams();
  const search = useSearchParams();
  const requestedPage = Number(search.get("page") || 1);
  const page = Number.isFinite(requestedPage) ? Math.min(50_001, Math.max(1, Math.trunc(requestedPage))) : 1;
  const id = params.id as string;
  const { user } = useAuth();

  const [dest, setDest] = useState<DestinationDetail | null>(null);
  const [reports, setReports] = useState<TripReport[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [d, r, count] = await Promise.all([
          getDestination(id),
          getTripReportsForDestination(id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
          getTripReportCountForDestination(id),
        ]);
        if (!cancelled) {
          setDest(d);
          setReports(r);
          setTotalCount(count);
        }
      } catch {
        if (!cancelled) setError("Couldn’t load trip reports. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id, page, retry]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="py-12 text-center text-muted">{LOADING_LABEL}</div>
      </div>
    );
  }

  if (error) {
    return <div className="mx-auto max-w-[1200px] px-6 py-8"><EmptyState title="Trip reports are unavailable"><p role="alert">{error}</p><div className="mt-5 flex flex-wrap justify-center gap-3"><Button onClick={() => setRetry((value) => value + 1)}>Try again</Button><Button href={`/destinations/${id}`} variant="secondary">Back to place</Button></div></EmptyState></div>;
  }

  if (!dest) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <EmptyState title="Destination not found" />
      </div>
    );
  }

  const destName = dest.name || "Unnamed";
  const writeHref = `/reports/new?dest=${id}`;

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
          title="Trip reports"
          meta={
            totalCount > 0 ? (
              <span>
                {totalCount.toLocaleString("en-US")} trip report{totalCount === 1 ? "" : "s"}
              </span>
            ) : undefined
          }
          className="min-w-0"
        />
        {/* One primary action, and only for a reader who can actually use
            it — the same signed-in gate the flagship page's own reports
            section applies to its "Write the first one" link. */}
        {user ? (
          <Button href={writeHref} size="sm">
            Write a report
          </Button>
        ) : null}
      </div>

      {reports.length === 0 ? (
        <EmptyState
          className="mt-10"
          title={totalCount > 0 ? "No reports on this page" : "No trip reports yet"}
          description={totalCount > 0 ? "Return to the first page to read the latest reports." : user ? "Been here? Write the first one." : undefined}
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
      <CatalogPagination page={page} pageCount={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))} href={(nextPage) => `/destinations/${encodeURIComponent(id)}/reports?page=${nextPage}`} />
    </div>
  );
}
