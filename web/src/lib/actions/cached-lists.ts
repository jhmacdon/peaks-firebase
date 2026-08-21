import "server-only";

import { cache } from "react";
import { getList, getListDestinations, getLists } from "./lists";

export const getCachedListDestinations = cache(getListDestinations);
// The unfiltered first page of lists, for surfaces that browse rather than
// search (Discover's "Browse lists"). The search/offset arguments are baked
// in for the same reason cached-routes.ts bakes in its options: only the
// limit varies, and a memo keyed on three arguments two of which never
// change is just a wider key.
export const getCachedListPage = cache((limit: number) => getLists(undefined, limit, 0));
// De-dupes the list-row lookup between layout.tsx (metadata/JSON-LD) and
// page.tsx (the body) within one request — same reasoning as
// cached-destinations.ts.
export const getCachedList = cache(getList);
