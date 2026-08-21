import "server-only";

import { cache } from "react";
import { getDestinationWeather } from "./weather";

// Same reasoning as cached-destinations.ts / cached-lists.ts: one memo
// table shared by every caller within a request. Weather is only read
// once today (destinations/[id]/page.tsx), not from layout.tsx too, but
// this keeps the action module itself free of `cache()` and matches the
// rest of `actions/` — a second caller (e.g. a future JSON-LD forecast
// field) gets de-duping for free instead of a second Firestore read.
export const getDestinationWeatherCached = cache(getDestinationWeather);
