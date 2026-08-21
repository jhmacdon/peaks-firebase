"use server";

import { adminDb } from "../firebase-admin";
import {
  buildDestinationWeatherStrip,
  type RawForecastEntry,
  type DestinationWeatherStrip,
} from "../weather-forecast";
export type { DestinationWeatherDay, DestinationWeatherStrip } from "../weather-forecast";

/** The public Firestore `weather` collection (see `firestore.rules`, which
 * allows read but never write/delete from a client) holds one doc per
 * destination: `{ destinationId, forecast: [...], lastUpdated }`. The writer
 * is peaks-api's `POST /internal/weather-refresh`
 * (`cloud-sql/api/src/weather-refresh.ts`). Cloud Scheduler job
 * `peaks-api-weather` runs it three times a day. It covers a bounded set —
 * a destination with at least three sessions, or on a curated list — about
 * 776 destinations today, not the full catalog. Each entry is a
 * Kelvin/mm/m-s daily forecast from Open-Meteo, dated at local noon with
 * an explicit UTC offset.
 *
 * This function reads the doc but treats it as present only when its
 * `forecast` entries land on real calendar days: `[today, today + 3]` in
 * the destination's own timezone (carried per entry) — see
 * `buildDestinationWeatherStrip` in `../weather-forecast.ts` for the
 * gate/parse logic (pure, covered by `weather-forecast.test.ts`). This is
 * why a stale doc self-gates: once its dates fall in the past, they drop
 * out of the window, `days` comes back empty, and this returns null with no
 * separate freshness check.
 *
 * Cost note: every destination page render does one Firestore query against
 * `weather` — for destinations outside the covered set, that's a billed
 * empty read once per hour (`revalidate = 3600` in
 * `destinations/[id]/layout.tsx`), which is negligible at Firestore's
 * per-read pricing and was accepted as-is rather than adding a skip-list or
 * a second cache layer for it. */
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
