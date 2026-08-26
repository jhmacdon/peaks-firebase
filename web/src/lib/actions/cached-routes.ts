import "server-only";

import { cache } from "react";
import { getRoute, getRouteDestinations } from "./routes";

// The route segment reads the same two rows twice per request — once in
// `layout.tsx` (JSON-LD + generateMetadata) and once in `page.tsx` (the
// body). React's `cache()` dedupes those calls, but only when both callers
// share ONE wrapped reference: `cache(getRoute)` called in two files
// produces two independent memo tables and two round trips. Hence this
// module, matching `cached-destinations.ts` / `cached-lists.ts`.
//
// The wrapped actions enforce the live Peaks catalog filter themselves;
// there is no caller-controlled raw mode.
//
// `server-only` keeps it out of any client bundle — these are direct
// database reads, not server actions to be invoked from the browser.
export const getRouteCached = cache((id: string) => getRoute(id));
export const getRouteDestinationsCached = cache((id: string) =>
  getRouteDestinations(id)
);
