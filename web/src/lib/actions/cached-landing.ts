import "server-only";

import { cache } from "react";
import { getActivityLandingData, getStateLandingData } from "./landing";

// Same reasoning as cached-search.ts / cached-lists.ts: generateMetadata and
// the page body both need this page's data, and without cache() that's two
// separate round trips (several joins each) for one request.
export const getActivityLandingDataCached = cache(getActivityLandingData);
export const getStateLandingDataCached = cache(getStateLandingData);
