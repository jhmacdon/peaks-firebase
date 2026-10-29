import "server-only";

import { cache } from "react";
import { getRecentTripReports, getTripReport, getTripReportCountForDestination, getTripReportsForDestination } from "./trip-reports";
import { getDestinationCached } from "./cached-destinations";

// The report segment reads the same row twice per request — once in
// `layout.tsx` (generateMetadata) and once in `page.tsx` (the body).
// React's `cache()` dedupes those calls, but only when both callers share
// ONE wrapped reference — matching `cached-destinations.ts` /
// `cached-lists.ts` / `cached-routes.ts`.
//
// `server-only` keeps it out of any client bundle — this is a direct
// database read, not a server action to be invoked from the browser.
export const getTripReportCached = cache(getTripReport);
// The recent-reports feed on /discover. Same one-shared-reference rule: the
// query joins destinations and photo blocks per report, so it is not one to
// run twice per request.
export const getRecentTripReportsCached = cache(getRecentTripReports);

// Shared by report-list metadata and body: only published reports are read.
export const getDestinationReportsPageCached = cache(async (id: string, requestedPage: number) => {
  const dest = await getDestinationCached(id);
  if (!dest) return null;
  const totalCount = await getTripReportCountForDestination(id);
  const pageCount = Math.max(1, Math.ceil(totalCount / 20));
  const page = Math.min(requestedPage, pageCount);
  const reports = totalCount ? await getTripReportsForDestination(id, 20, (page - 1) * 20) : [];
  return { dest, reports, totalCount, page };
});
