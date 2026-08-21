"use server";

import { adminDb } from "../firebase-admin";
import {
  buildDestinationWeatherStrip,
  type RawForecastEntry,
  type DestinationWeatherStrip,
} from "../weather-forecast";
export type { DestinationWeatherDay, DestinationWeatherStrip } from "../weather-forecast";

/** The public Firestore `weather` collection (see `firestore.rules`, which
 * allows read but never write/delete from a client — every document was
 * written by a backend job) and its shape mirrors
 * `functions/src/destinationHelpers.ts`'s `getDestinationWeather`: one doc
 * per destination, `{ destinationId, forecast: [...], current, lastUpdated }`
 * in a Weatherbit-style layout (`api.weatherbit.io`, `units=S` — Kelvin
 * temperatures, mm precipitation, m/s wind; identified from the retired
 * writer's field names, not OpenWeatherMap as an earlier draft of this
 * comment said).
 *
 * Investigation before writing this file (2026-08-20): the collection is
 * real but orphaned. `gcloud functions list --project=donner-a8608` has no
 * weather-related entry — `getDestinationWeather` in destinationHelpers.ts
 * is never imported by `functions/src/index.ts`, so it isn't wired to any
 * deployed callable or HTTP function; there is nothing to fall back to
 * there. A full-collection sample (497 docs total, all of them) put every
 * `lastUpdated` between Jan 2021 and Nov 2022 — including Mount Rainier's —
 * with nothing more recent. No scheduled function refreshes it (compare
 * `avyUpdate`, which does run every 4 hours for a different feature). 497
 * documents also only covers a sliver of the ~70,000-destination catalog.
 * The feature this fed was retired years ago; the collection was never
 * deleted.
 *
 * Given that, this reads the real per-destination document (right shape,
 * right key) but treats it as present only when its own `forecast` entries
 * land on real calendar days: `[today, today + 3]` in the destination's own
 * timezone (carried per forecast entry) — see `buildDestinationWeatherStrip`
 * in `../weather-forecast.ts` for the actual gate/parse logic (pure,
 * covered by `weather-forecast.test.ts`). That isn't an arbitrary staleness
 * cutoff — a stale document's forecast dates are all in the past, so they
 * fall out of the window on their own, `days` comes back empty, and this
 * returns null. Every destination's weather section is absent today as a
 * direct, mechanical result — not a hardcoded flag. If the collection were
 * ever written to again, this starts rendering with no code change.
 *
 * Destination pages revalidate hourly (`revalidate = 3600` in
 * `destinations/[id]/layout.tsx`) — a forecast up to an hour stale is fine
 * for this UI. The upstream data's own cadence, when it was live, was
 * whatever cron wrote `lastUpdated`; that job no longer runs.
 *
 * Cost note: every destination page render does one Firestore query against
 * `weather` — for the ~69,500 destinations with no doc at all, that's a
 * billed empty read once per hour (the page's ISR window), which is
 * negligible at Firestore's per-read pricing and was accepted as-is rather
 * than adding a skip-list or a second cache layer for it. */
export async function getDestinationWeather(
  destinationId: string
): Promise<DestinationWeatherStrip | null> {
  const snapshot = await adminDb
    .collection("weather")
    .where("destinationId", "==", destinationId)
    .limit(1)
    .get();

  const doc = snapshot.docs[0];
  if (!doc) return null;

  const data = doc.data() as { forecast?: RawForecastEntry[] };
  return buildDestinationWeatherStrip(Array.isArray(data.forecast) ? data.forecast : []);
}
