// Open-Meteo air-quality client (CAMS model) with a small in-process TTL
// cache. Free and keyless; the CC BY 4.0 attribution requirement is met by
// the web/iOS card credit lines. Failures always resolve to null — the
// endpoint degrades to whatever HRRR rows exist rather than erroring.

import { CamsData } from "./air-quality";

const BASE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 5000;

export type CamsFetcher = (lat: number, lng: number) => Promise<CamsData | null>;

const cache = new Map<string, { at: number; data: CamsData }>();

export function clearCamsCache(): void {
  cache.clear();
}

export async function fetchCams(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now
): Promise<CamsData | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && nowMs() - hit.at < TTL_MS) return hit.data;

  const url =
    `${BASE_URL}?latitude=${lat}&longitude=${lng}` +
    `&hourly=pm2_5,us_aqi&forecast_days=7&timezone=auto&timeformat=unixtime`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      timezone?: string;
      utc_offset_seconds?: number;
      hourly?: { time?: number[]; pm2_5?: (number | null)[]; us_aqi?: (number | null)[] };
    };
    if (!Array.isArray(body?.hourly?.time)) return null;
    const data: CamsData = {
      timezone: body.timezone ?? "UTC",
      utcOffsetSeconds: body.utc_offset_seconds ?? 0,
      timesSec: body.hourly!.time!,
      pm25: body.hourly!.pm2_5 ?? [],
      usAqi: body.hourly!.us_aqi ?? [],
    };
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: nowMs(), data });
    return data;
  } catch {
    return null;
  }
}
