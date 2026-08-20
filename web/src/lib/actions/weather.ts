"use server";

import { adminDb } from "../firebase-admin";

/** The public Firestore `weather` collection (see `firestore.rules`, which
 * allows read but never write/delete from a client — every document was
 * written by a backend job) and its shape mirrors
 * `functions/src/destinationHelpers.ts`'s `getDestinationWeather`: one doc
 * per destination, `{ destinationId, forecast: [...], current, lastUpdated }`
 * in an OpenWeatherMap-style layout (Kelvin temperatures, mm precipitation,
 * m/s wind).
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
 * timezone (carried per forecast entry). That isn't an arbitrary staleness
 * cutoff — a stale document's forecast dates are all in the past, so they
 * fall out of the window on their own, `days` comes back empty, and this
 * returns null. Every destination's weather section is absent today as a
 * direct, mechanical result — not a hardcoded flag. If the collection were
 * ever written to again, this starts rendering with no code change.
 *
 * Destination pages revalidate hourly (`revalidate = 3600` in
 * `destinations/[id]/layout.tsx`) — a forecast up to an hour stale is fine
 * for this UI. The upstream data's own cadence, when it was live, was
 * whatever cron wrote `lastUpdated`; that job no longer runs. */

export interface DestinationWeatherDay {
  /** "Today", "Tomorrow", or a short weekday ("Wed") — never blank. */
  label: string;
  highF: number;
  lowF: number;
  /** Combined rain + snow, inches. A legitimate 0 when the forecast calls
   * for none — not a stand-in for missing data. */
  precipIn: number;
  precipKind: "rain" | "snow" | "none";
  windMph: number;
  /** Compass abbreviation ("NW"), or "—" only when the source doc truly
   * has no direction — matches the app's existing empty-value convention
   * (see CLAUDE.md's "Features row" rule). */
  windDirection: string;
}

export interface DestinationWeatherStrip {
  days: DestinationWeatherDay[];
}

const WINDOW_DAYS = 4; // today + 3

interface RawWind {
  speed?: number;
  direction?: number;
}

interface RawForecastEntry {
  date?: string;
  timezone?: string;
  temperatureMax?: number;
  temperatureMin?: number;
  rain?: number;
  snow?: number;
  wind?: RawWind;
}

interface RawWeatherDoc {
  destinationId?: string;
  forecast?: RawForecastEntry[];
}

function kelvinToF(kelvin: number): number {
  return Math.round(((kelvin - 273.15) * 9) / 5 + 32);
}

function mpsToMph(metersPerSecond: number): number {
  return Math.round(metersPerSecond * 2.23694);
}

function mmToInches(millimeters: number): number {
  return Math.round((millimeters / 25.4) * 10) / 10;
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function degreesToCompass(degrees: number): string {
  const index = Math.round(degrees / 22.5) % 16;
  return COMPASS_POINTS[(index + 16) % 16];
}

/** Calendar-date key ("2026-08-20") for an ISO timestamp, read in the given
 * IANA timezone. `en-CA` is the one built-in locale whose short date format
 * is already `YYYY-MM-DD`. */
function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

function shortWeekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
}

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

  const data = doc.data() as RawWeatherDoc;
  const forecast = Array.isArray(data.forecast) ? data.forecast : [];
  if (forecast.length === 0) return null;

  const referenceTimeZone = forecast.find((entry) => entry.timezone)?.timezone || "UTC";
  const now = new Date();

  const allowedKeys = new Set<string>();
  const labelsByKey = new Map<string, string>();
  for (let offset = 0; offset < WINDOW_DAYS; offset++) {
    const day = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const key = localDateKey(day.toISOString(), referenceTimeZone);
    allowedKeys.add(key);
    labelsByKey.set(
      key,
      offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : shortWeekday(day, referenceTimeZone)
    );
  }

  const days = forecast
    .filter(
      (entry): entry is RawForecastEntry & { date: string; temperatureMax: number; temperatureMin: number } =>
        typeof entry.date === "string" &&
        typeof entry.temperatureMax === "number" &&
        typeof entry.temperatureMin === "number"
    )
    .map((entry) => ({
      entry,
      key: localDateKey(entry.date, entry.timezone || referenceTimeZone),
    }))
    .filter(({ key }) => allowedKeys.has(key))
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date))
    .slice(0, WINDOW_DAYS)
    .map(({ entry, key }): DestinationWeatherDay => {
      const rainIn = mmToInches(entry.rain ?? 0);
      const snowIn = mmToInches(entry.snow ?? 0);
      const precipIn = Math.round((rainIn + snowIn) * 10) / 10;
      return {
        label: labelsByKey.get(key) ?? key,
        highF: kelvinToF(entry.temperatureMax),
        lowF: kelvinToF(entry.temperatureMin),
        precipIn,
        precipKind: precipIn <= 0 ? "none" : snowIn >= rainIn ? "snow" : "rain",
        windMph: typeof entry.wind?.speed === "number" ? mpsToMph(entry.wind.speed) : 0,
        windDirection:
          typeof entry.wind?.direction === "number" ? degreesToCompass(entry.wind.direction) : "—",
      };
    });

  if (days.length === 0) return null;
  return { days };
}
