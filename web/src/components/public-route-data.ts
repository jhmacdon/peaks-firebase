import { cache } from "react";
import { getPublicPlanBundle } from "../lib/actions/public-plans";

// The public page and its metadata read the same visibility-filtered bundle
// during one render. React cache keeps that to one database call.
export const getPublicRouteBundle = cache(getPublicPlanBundle);
