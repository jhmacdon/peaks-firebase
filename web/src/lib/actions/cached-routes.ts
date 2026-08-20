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
// `{ publicOnly: true }` is baked into the wrapped function rather than
// passed in by each caller: `cache()` keys on argument identity, and a
// fresh `{ publicOnly: true }` object literal at each call site would be a
// different reference every time, defeating the memo entirely. Baking it
// in also means every caller of this module gets the public-only filter by
// construction — there's no raw, unfiltered variant to accidentally reach
// for from a public page.
//
// `server-only` keeps it out of any client bundle — these are direct
// database reads, not server actions to be invoked from the browser.
export const getRouteCached = cache((id: string) => getRoute(id, { publicOnly: true }));
export const getRouteDestinationsCached = cache((id: string) =>
  getRouteDestinations(id, { publicOnly: true })
);
