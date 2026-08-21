// Pure parsing/gating logic for the destination weather strip — no Firestore,
// no "use server", so it's directly `node --test`-able (see
// `weather-forecast.test.ts`). `lib/actions/weather.ts` is a thin wrapper:
// fetch the doc via Firebase Admin, hand its `forecast` array to
// `buildDestinationWeatherStrip` here.

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

export interface RawWind {
  speed?: number;
  direction?: number;
}

export interface RawForecastEntry {
  date?: string;
  timezone?: string;
  temperatureMax?: number;
  temperatureMin?: number;
  rain?: number;
  snow?: number;
  wind?: RawWind;
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

/** The in-window gate + unit conversion. `now` defaults to the real clock
 * but is a parameter specifically so tests can pin it — the gate compares
 * each forecast entry's own date against `[now, now + 3 days]`, so a fixed
 * `now` is what makes "this stale 2021 doc yields null" and "this in-window
 * doc yields days" both deterministic.
 *
 * Returns null when nothing in `forecast` falls in the window — a stale
 * document's dates are all in the past, so this is what makes staleness
 * self-correcting rather than a magic-number cutoff (see weather.ts's doc
 * comment for the full reasoning). */
export function buildDestinationWeatherStrip(
  forecast: RawForecastEntry[],
  now: Date = new Date()
): DestinationWeatherStrip | null {
  if (!Array.isArray(forecast) || forecast.length === 0) return null;

  const referenceTimeZone = forecast.find((entry) => entry.timezone)?.timezone || "UTC";

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
      // Falls back to the doc's reference timezone when an individual
      // entry doesn't carry its own — in practice every entry in one doc
      // shares one timezone, but this keeps a partially-shaped entry from
      // being silently dropped by the window filter below.
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
        // Known ambiguity (flagged in review, not resolved here): a missing
        // `wind.speed`/`rain`/`snow` collapses to the same 0 as a real
        // "calm"/"no precip" reading — the source doc never distinguishes
        // "field absent" from "field measured zero", so neither can this
        // parser. `windDirection` doesn't have that problem (compass
        // labels have no natural zero), which is why only it gets "—".
        windMph: typeof entry.wind?.speed === "number" ? mpsToMph(entry.wind.speed) : 0,
        windDirection:
          typeof entry.wind?.direction === "number" ? degreesToCompass(entry.wind.direction) : "—",
      };
    });

  if (days.length === 0) return null;
  return { days };
}
