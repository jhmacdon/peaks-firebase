import { Suspense } from "react";
import SearchBar, { SearchFieldSkeleton } from "../../../components/search-bar";
import { PageHeader } from "../../../components/ui/page-header";
import { DiscoverCatalogStats } from "../../../components/discover/discover-catalog-stats";
import { DiscoverChips } from "../../../components/discover/discover-chips";
import { DiscoverLists } from "../../../components/discover/discover-lists";
import { DiscoverNearby } from "../../../components/discover/discover-nearby";
import { DiscoverPopular } from "../../../components/discover/discover-popular";
import { DiscoverReports } from "../../../components/discover/discover-reports";
import { DiscoverResults } from "../../../components/discover/discover-results";
import { DiscoverRoutes } from "../../../components/discover/discover-routes";
import {
  DiscoverBrowse,
  DiscoverStateProvider,
} from "../../../components/discover/discover-state";
import { getCachedListPage } from "../../../lib/actions/cached-lists";
import { getRecentTripReportsCached } from "../../../lib/actions/cached-reports";
import {
  getDiscoverStatsCached,
  getPopularDestinationsCached,
  getPopularRoutesCached,
} from "../../../lib/actions/cached-search";
import { settled } from "../../../lib/settled";

// The catalog home. Everything a reader can browse arrives with the page:
// five database reads on the server, rendered into the HTML, cached for an
// hour. Only the two things that cannot be prerendered are client islands —
// the search results (they answer a query the URL only knows in the browser)
// and Nearby (only the browser knows where the reader is).
//
// Every read goes through settled(), so a database that is down costs the
// section it feeds rather than the page, and marks the render uncacheable so
// the next request tries again instead of pinning a thin page for an hour.
//
// Title, description, canonical, and social cards live in layout.tsx and are
// unchanged — a `metadata` export here would replace that openGraph object
// wholesale rather than merge into it, which is how this page lost its
// og:image once already.
export const revalidate = 3600;

const SEARCH_PLACEHOLDER = "Search peaks, areas, routes, and lists";

const POPULAR_DESTINATION_COUNT = 12;
const FEATURED_ROUTE_COUNT = 6;
const BROWSE_LIST_COUNT = 6;
const RECENT_REPORT_COUNT = 6;

export default async function DiscoverPage() {
  const [popular, routes, lists, reports, stats] = await Promise.all([
    settled(getPopularDestinationsCached(POPULAR_DESTINATION_COUNT), {
      destinations: [],
      isFallback: false,
    }),
    settled(getPopularRoutesCached(FEATURED_ROUTE_COUNT), []),
    settled(getCachedListPage(BROWSE_LIST_COUNT), { lists: [], total: 0 }),
    settled(getRecentTripReportsCached(RECENT_REPORT_COUNT), []),
    settled(getDiscoverStatsCached(), null),
  ]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <DiscoverStateProvider>
        <PageHeader
          title="Discover"
          meta={<p>Find a peak, a protected area, a route, or a list.</p>}
        />

        <div className="mt-6 max-w-2xl">
          <Suspense fallback={<SearchFieldSkeleton placeholder={SEARCH_PLACEHOLDER} />}>
            <SearchBar placeholder={SEARCH_PLACEHOLDER} />
          </Suspense>
          <DiscoverChips />
        </div>

        <Suspense fallback={null}>
          <DiscoverResults />
        </Suspense>

        <DiscoverBrowse>
          <DiscoverPopular
            destinations={popular.destinations}
            isFallback={popular.isFallback}
          />
          <DiscoverRoutes routes={routes} />
          <DiscoverLists lists={lists.lists} />
          <DiscoverReports reports={reports} />
          <DiscoverNearby />
          <DiscoverCatalogStats stats={stats} />
        </DiscoverBrowse>
      </DiscoverStateProvider>
    </div>
  );
}
