// Destination weather refresh: fetches a short-range forecast per destination
// from Open-Meteo (free/keyless, same posture as the CAMS client in
// open-meteo.ts) and writes the Firestore `weather` doc the web app's
// destination page already reads (`web/src/lib/actions/weather.ts` /
// `buildDestinationWeatherStrip`). Invoked by Cloud Scheduler via
// POST /internal/weather-refresh (see index.ts) — the scheduler request is
// the only CPU window this work runs in, matching the sweep's pattern.
//
// Failures degrade rather than throw: a destination whose batch request
// fails just keeps its stale doc (the reader's own staleness window already
// treats an old forecast as absent), and the endpoint always returns counts.
//
// Firestore types are imported from "firebase-admin/firestore" rather than
// "firebase-admin" itself, and only `FieldValue` (a plain class, no app
// needed) is used at runtime — the Firestore instance is a parameter, so
// this module never calls `admin.initializeApp()` and stays test-importable
// without the SDK initialized.
import { Pool } from "pg";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";

export const MIN_SESSIONS = 3;
export const FORECAST_DAYS = 7;
export const LOCATION_BATCH_SIZE = 50;
export const FETCH_TIMEOUT_MS = 10000;

export interface WeatherTarget {
  id: string;
  lat: number;
  lng: number;
}

export interface ForecastWind {
  speed?: number;
  direction?: number;
}

export interface ForecastEntry {
  date: string;
  timezone: string;
  temperatureMax: number;
  temperatureMin: number;
  rain: number;
  snow: number;
  wind: ForecastWind;
}

/** Shape of one location's entry in an Open-Meteo `daily=...` response. A
 * multi-location request returns an array of these; a single-location
 * request returns one bare object (see `fetchDailyForecasts`). */
export interface OpenMeteoDailyResult {
  utc_offset_seconds?: number;
  timezone?: string;
  daily?: {
    time?: (string | null | undefined)[];
    temperature_2m_max?: (number | null | undefined)[];
    temperature_2m_min?: (number | null | undefined)[];
    rain_sum?: (number | null | undefined)[];
    showers_sum?: (number | null | undefined)[];
    snowfall_sum?: (number | null | undefined)[];
    wind_speed_10m_max?: (number | null | undefined)[];
    wind_direction_10m_dominant?: (number | null | undefined)[];
  };
}

// Mirrors the popular-destinations expression in web/src/lib/actions/search.ts:
// a destination counts as a weather target once real session traffic (plus
// its pre-migration session_count_offset) clears MIN_SESSIONS, OR it's a
// member of any curated list regardless of session count.
const WEATHER_TARGETS_SQL = `
  WITH counts AS (
    SELECT destination_id, COUNT(DISTINCT session_id) AS session_count
    FROM session_destinations GROUP BY destination_id
  )
  SELECT d.id,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lng
  FROM destinations d
  LEFT JOIN counts ON counts.destination_id = d.id
  WHERE d.location IS NOT NULL
    AND (COALESCE(counts.session_count, 0) + d.session_count_offset >= $1
         OR EXISTS (SELECT 1 FROM list_destinations ld WHERE ld.destination_id = d.id))
`;

export async function selectWeatherTargets(pool: Pool): Promise<WeatherTarget[]> {
  const result = await pool.query<WeatherTarget>(WEATHER_TARGETS_SQL, [MIN_SESSIONS]);
  return result.rows;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `daily.time[i]` must be a real `YYYY-MM-DD` calendar day: it's spliced
 * unvalidated into the doc's `date` field (`${time[i]}T12:00:00${offset}`),
 * and a null/undefined/malformed element would otherwise pass the web
 * reader's typeof-string filter (`RawForecastEntry.date`) only to throw a
 * RangeError inside `new Date()`/Intl during SSR of a public destination
 * page. Format-checked *and* parsed (belt-and-braces) rather than trusting
 * the regex alone. */
function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `utc_offset_seconds` (e.g. -25200) -> "-07:00"; 19800 -> "+05:30"; 0 ->
 * "+00:00". Zero-padded, minutes handled. */
function formatUtcOffset(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? "-" : "+";
  const absSeconds = Math.abs(offsetSeconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Pure mapper: one Open-Meteo per-location result -> the doc's `forecast`
 * array. An entry whose max or min temperature is null/undefined/non-finite
 * is skipped outright — the web parser (`buildDestinationWeatherStrip`)
 * requires both as numbers, so a half-formed entry there is worse than no
 * entry. */
export function buildForecastEntries(result: OpenMeteoDailyResult): ForecastEntry[] {
  const daily = result.daily;
  const times = daily?.time ?? [];
  const offset = formatUtcOffset(result.utc_offset_seconds ?? 0);
  const timezone = result.timezone ?? "UTC";

  const entries: ForecastEntry[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    if (!isValidDateString(time)) continue;

    const temperatureMax = daily?.temperature_2m_max?.[i];
    const temperatureMin = daily?.temperature_2m_min?.[i];
    if (!isFiniteNumber(temperatureMax) || !isFiniteNumber(temperatureMin)) continue;

    const wind: ForecastWind = {};
    const speed = daily?.wind_speed_10m_max?.[i];
    const direction = daily?.wind_direction_10m_dominant?.[i];
    if (isFiniteNumber(speed)) wind.speed = speed;
    if (isFiniteNumber(direction)) wind.direction = direction;

    entries.push({
      date: `${time}T12:00:00${offset}`,
      timezone,
      temperatureMax: round2(temperatureMax + 273.15),
      temperatureMin: round2(temperatureMin + 273.15),
      rain: round2((daily?.rain_sum?.[i] ?? 0) + (daily?.showers_sum?.[i] ?? 0)),
      snow: round2((daily?.snowfall_sum?.[i] ?? 0) * 10),
      wind,
    });
  }
  return entries;
}

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "rain_sum",
  "showers_sum",
  "snowfall_sum",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
].join(",");

function buildBatchUrl(targets: WeatherTarget[]): string {
  const latitude = targets.map((target) => target.lat).join(",");
  const longitude = targets.map((target) => target.lng).join(",");
  return (
    `${OPEN_METEO_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=${DAILY_VARS}&forecast_days=${FORECAST_DAYS}&timezone=auto&windspeed_unit=ms`
  );
}

/** Fetches and maps one batch (<= LOCATION_BATCH_SIZE targets, one request).
 * A non-ok response, a thrown fetch, or a body that's neither an array nor
 * an object is logged and the whole batch is skipped — its targets are
 * simply absent from the returned map; the caller's other batches are
 * unaffected. */
async function fetchBatch(
  targets: WeatherTarget[],
  fetchImpl: typeof fetch
): Promise<Map<string, ForecastEntry[]>> {
  const map = new Map<string, ForecastEntry[]>();
  let body: unknown;
  try {
    const res = await fetchImpl(buildBatchUrl(targets), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[weather] batch fetch failed: HTTP ${res.status}`);
      return map;
    }
    body = await res.json();
  } catch (err) {
    console.warn("[weather] batch fetch failed:", (err as Error).message);
    return map;
  }

  if (body === null || typeof body !== "object") {
    console.warn("[weather] batch fetch failed: malformed response body");
    return map;
  }

  // A single-location request returns one bare object; wrap it so both
  // shapes map the same way, positionally, onto this batch's targets.
  const results = Array.isArray(body) ? body : [body];
  results.forEach((result, index) => {
    const target = targets[index];
    // A stray non-object element (e.g. a malformed-but-200 array entry) is
    // just skipped, same as an out-of-range index — buildForecastEntries
    // reads result.daily, which would throw on null.
    if (!target || result === null || typeof result !== "object") return;
    map.set(target.id, buildForecastEntries(result as OpenMeteoDailyResult));
  });
  return map;
}

/** Chunks `targets` into LOCATION_BATCH_SIZE-sized multi-location requests
 * and merges every batch's results into one map keyed by destination id. */
export async function fetchDailyForecasts(
  targets: WeatherTarget[],
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, ForecastEntry[]>> {
  const combined = new Map<string, ForecastEntry[]>();
  for (let i = 0; i < targets.length; i += LOCATION_BATCH_SIZE) {
    const chunk = targets.slice(i, i + LOCATION_BATCH_SIZE);
    const batchResults = await fetchBatch(chunk, fetchImpl);
    for (const [id, entries] of batchResults) combined.set(id, entries);
  }
  return combined;
}

/** Runs one full refresh: selects targets, fetches forecasts, and writes the
 * Firestore `weather` doc for every target that got a non-empty forecast.
 * Always returns counts rather than throwing on a partial failure — only a
 * failure in `selectWeatherTargets` (DB down) or the bulk write itself
 * propagates, matching the endpoint's single try/catch in index.ts. */
export async function refreshDestinationWeather(
  pool: Pool,
  db: Firestore,
  fetchImpl: typeof fetch = fetch
): Promise<{ total: number; refreshed: number; skipped: number }> {
  const targets = await selectWeatherTargets(pool);

  // Legacy doc-id mapping, loaded once: the `weather` collection predates
  // this writer and its doc IDs don't match destination IDs, so the reader's
  // `.where("destinationId","==",id).limit(1)` is the only lookup that
  // works. First doc per destinationId wins; if a destinationId somehow
  // appears on more than one doc, the extras are deleted in this same run —
  // left alone, they'd make that `.limit(1)` pick an arbitrary one.
  const legacyDocs = await db.collection("weather").select("destinationId").get();
  const refByDestinationId = new Map<string, DocumentReference>();
  const extraRefs: DocumentReference[] = [];
  for (const doc of legacyDocs.docs) {
    const destinationId = doc.get("destinationId");
    if (typeof destinationId !== "string" || !destinationId) continue;
    if (refByDestinationId.has(destinationId)) {
      extraRefs.push(doc.ref);
    } else {
      refByDestinationId.set(destinationId, doc.ref);
    }
  }

  const forecasts = await fetchDailyForecasts(targets, fetchImpl);

  const writer = db.bulkWriter();
  // BulkWriter's own default error handler already retries a bounded set of
  // transient codes (UNAVAILABLE/ABORTED) before giving up; overriding it
  // here adds no retry policy of our own — returning false always means
  // "don't retry beyond whatever BulkWriter's own attempt already did".
  // What this buys is visibility: without a handler, a write BulkWriter
  // ultimately gives up on (bad IAM, a rules rejection, an oversized doc)
  // is silently dropped, `refreshed` still counts it (it was enqueued, not
  // written), and the endpoint logs "refreshed 776/776" while some
  // destinations got nothing. A destination whose write fails here just
  // keeps its stale doc and gets picked up again on the next scheduled run.
  writer.onWriteError((error) => {
    console.warn(
      `[weather] write failed for ${error.documentRef.path} (${error.operationType}):`,
      error.message
    );
    return false;
  });

  // Every set()/delete() promise settles independently of writer.close() —
  // catch each one so a permanent failure (onWriteError returning false)
  // can never surface as an unhandled rejection (fatal under this service's
  // default --unhandled-rejections=throw, see lib/async-route.ts).
  for (const ref of extraRefs) {
    writer.delete(ref).catch(() => {});
  }

  const total = targets.length;
  const pendingWrites: Promise<boolean>[] = [];
  for (const target of targets) {
    const forecast = forecasts.get(target.id);
    if (!forecast || forecast.length === 0) continue;
    const ref = refByDestinationId.get(target.id) ?? db.collection("weather").doc(target.id);
    pendingWrites.push(
      writer
        .set(ref, {
          destinationId: target.id,
          forecast,
          lastUpdated: FieldValue.serverTimestamp(),
        })
        .then(() => true)
        .catch(() => false)
    );
  }
  await writer.close();

  // `refreshed` counts settled successful writes, not enqueues — a write
  // BulkWriter ultimately failed (logged above) is excluded here even
  // though it was queued, so the returned count matches what's actually in
  // Firestore.
  const settled = await Promise.all(pendingWrites);
  const refreshed = settled.filter(Boolean).length;
  const skipped = total - refreshed;
  console.log(`[weather] refreshed ${refreshed}/${total} destinations, ${skipped} skipped`);
  return { total, refreshed, skipped };
}
