import "server-only";

import { cache } from "react";
import { getList, getListDestinations } from "./lists";

export const getCachedListDestinations = cache(getListDestinations);
// De-dupes the list-row lookup between layout.tsx (metadata/JSON-LD) and
// page.tsx (the body) within one request — same reasoning as
// cached-destinations.ts.
export const getCachedList = cache(getList);
