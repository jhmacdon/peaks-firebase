import "server-only";

import { cache } from "react";
import { getDestination, getDestinationSessionCount } from "./destinations";

// The destination segment reads the same two rows twice per request — once
// in `layout.tsx` (JSON-LD + generateMetadata) and once in `page.tsx` (the
// body). React's `cache()` dedupes those calls, but only when both callers
// share ONE wrapped reference: `cache(getDestination)` called in two files
// produces two independent memo tables and two round trips. Hence this
// module, matching `cached-lists.ts`.
//
// `server-only` keeps it out of any client bundle — these are direct
// database reads, not server actions to be invoked from the browser.
export const getDestinationCached = cache(getDestination);
export const getDestinationSessionCountCached = cache(getDestinationSessionCount);
