import "server-only";

import { cache } from "react";
import {
  getDiscoverStats,
  getPopularDestinations,
  getPopularRoutes,
} from "./search";

// The catalog reads behind /discover, wrapped the same way
// `cached-destinations.ts` / `cached-lists.ts` / `cached-routes.ts` wrap
// theirs: ONE shared reference per query, so every server component on the
// route that wants the same data gets one round trip rather than one each.
// The counts in particular are four `COUNT(*)`s over the whole catalog
// against a five-connection pool — not something to read twice because two
// components both wanted them.
//
// The limits are passed as plain numbers, which `cache()` keys on by value.
// (An options object would defeat the memo: a fresh literal at each call
// site is a different reference every time — see cached-routes.ts.)
//
// `server-only` keeps these out of any client bundle: they are direct
// database reads, not server actions for the browser to invoke.
export const getDiscoverStatsCached = cache(getDiscoverStats);
export const getPopularDestinationsCached = cache(getPopularDestinations);
export const getPopularRoutesCached = cache(getPopularRoutes);
