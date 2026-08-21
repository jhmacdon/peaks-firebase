// weather-refresh: pure mapper + batching tests, no network and no Firestore
// init (fetch is injected; refreshDestinationWeather/selectWeatherTargets are
// exercised through their own integration paths, not here). The endpoint auth
// test hits the exported `app` directly with supertest, mirroring sweep's
// contract test in route-error-handling.test.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import request from "supertest";
import type { Pool } from "pg";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { app } from "../index";
import {
  buildForecastEntries,
  fetchDailyForecasts,
  refreshDestinationWeather,
  FORECAST_DAYS,
  LOCATION_BATCH_SIZE,
  type OpenMeteoDailyResult,
  type WeatherTarget,
} from "../weather-refresh";

// Real Open-Meteo daily response for one location, from the task brief.
const SAMPLE_RESULT: OpenMeteoDailyResult = {
  utc_offset_seconds: -25200,
  timezone: "America/Los_Angeles",
  daily: {
    time: ["2026-08-20", "2026-08-21"],
    temperature_2m_max: [-0.8, 3.2],
    temperature_2m_min: [-7.6, -2.1],
    rain_sum: [0.0, 1.5],
    showers_sum: [0.0, 0.5],
    snowfall_sum: [0.21, 0.0],
    wind_speed_10m_max: [5.36, 2.1],
    wind_direction_10m_dominant: [248, 90],
  },
};

function fakeFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: string[] = [];
  let index = 0;
  const fn = (async (url: any) => {
    calls.push(String(url));
    const { status = 200, body = {} } = responses[index] ?? {};
    index += 1;
    return {
      ok: status === 200,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

function dailyResultFor(tempMaxC: number): OpenMeteoDailyResult {
  return {
    utc_offset_seconds: 0,
    timezone: "UTC",
    daily: {
      time: ["2026-08-20"],
      temperature_2m_max: [tempMaxC],
      temperature_2m_min: [tempMaxC - 5],
      rain_sum: [0],
      showers_sum: [0],
      snowfall_sum: [0],
      wind_speed_10m_max: [1],
      wind_direction_10m_dominant: [1],
    },
  };
}

test("buildForecastEntries maps the real sample: Kelvin, rain+showers, snow cm->mm, wind, date, timezone", () => {
  const entries = buildForecastEntries(SAMPLE_RESULT);

  assert.equal(entries.length, 2);
  const [entry] = entries;
  assert.equal(entry.date, "2026-08-20T12:00:00-07:00");
  assert.equal(entry.timezone, "America/Los_Angeles");
  assert.equal(entry.temperatureMax, 272.35);
  assert.equal(entry.temperatureMin, 265.55);
  assert.equal(entry.rain, 0);
  assert.equal(entry.snow, 2.1);
  assert.deepEqual(entry.wind, { speed: 5.36, direction: 248 });
});

test("buildForecastEntries sums rain_sum + showers_sum", () => {
  const [entry] = buildForecastEntries({
    timezone: "UTC",
    daily: {
      time: ["2026-08-20"],
      temperature_2m_max: [10],
      temperature_2m_min: [0],
      rain_sum: [2],
      showers_sum: [1.5],
      snowfall_sum: [0],
      wind_speed_10m_max: [0],
      wind_direction_10m_dominant: [0],
    },
  });
  assert.equal(entry.rain, 3.5);
});

test("buildForecastEntries formats utc_offset_seconds as +/-HH:MM, zero-padded", () => {
  const [entry] = buildForecastEntries({
    utc_offset_seconds: 19800, // +05:30 (e.g. India)
    timezone: "Asia/Kolkata",
    daily: {
      time: ["2026-08-20"],
      temperature_2m_max: [10],
      temperature_2m_min: [0],
      rain_sum: [0],
      showers_sum: [0],
      snowfall_sum: [0],
      wind_speed_10m_max: [0],
      wind_direction_10m_dominant: [0],
    },
  });
  assert.equal(entry.date, "2026-08-20T12:00:00+05:30");
});

test("buildForecastEntries: missing/zero utc_offset_seconds -> +00:00, missing timezone -> UTC", () => {
  const [entry] = buildForecastEntries({
    daily: {
      time: ["2026-08-20"],
      temperature_2m_max: [10],
      temperature_2m_min: [0],
      rain_sum: [0],
      showers_sum: [0],
      snowfall_sum: [0],
      wind_speed_10m_max: [0],
      wind_direction_10m_dominant: [0],
    },
  });
  assert.equal(entry.date, "2026-08-20T12:00:00+00:00");
  assert.equal(entry.timezone, "UTC");
});

test("buildForecastEntries skips an entry with a null temperatureMax; other entries survive", () => {
  const entries = buildForecastEntries({
    timezone: "UTC",
    daily: {
      time: ["2026-08-20", "2026-08-21"],
      temperature_2m_max: [null as unknown as number, 12],
      temperature_2m_min: [-5, 2],
      rain_sum: [0, 0],
      showers_sum: [0, 0],
      snowfall_sum: [0, 0],
      wind_speed_10m_max: [1, 1],
      wind_direction_10m_dominant: [1, 1],
    },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-08-21T12:00:00+00:00");
});

test("buildForecastEntries skips an entry with a null/undefined temperatureMin too", () => {
  const entries = buildForecastEntries({
    timezone: "UTC",
    daily: {
      time: ["2026-08-20"],
      temperature_2m_max: [12],
      temperature_2m_min: [undefined as unknown as number],
      rain_sum: [0],
      showers_sum: [0],
      snowfall_sum: [0],
      wind_speed_10m_max: [1],
      wind_direction_10m_dominant: [1],
    },
  });
  assert.equal(entries.length, 0);
});

test("buildForecastEntries skips an entry whose time is null/undefined; other entries survive", () => {
  const entries = buildForecastEntries({
    timezone: "UTC",
    daily: {
      time: [null as unknown as string, "2026-08-21", undefined as unknown as string],
      temperature_2m_max: [10, 12, 14],
      temperature_2m_min: [0, 2, 4],
      rain_sum: [0, 0, 0],
      showers_sum: [0, 0, 0],
      snowfall_sum: [0, 0, 0],
      wind_speed_10m_max: [1, 1, 1],
      wind_direction_10m_dominant: [1, 1, 1],
    },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-08-21T12:00:00+00:00");
});

test("buildForecastEntries skips an entry whose time is not a real YYYY-MM-DD day", () => {
  const entries = buildForecastEntries({
    timezone: "UTC",
    daily: {
      time: ["not-a-date", "2026-13-40", "2026-08-21"],
      temperature_2m_max: [10, 12, 14],
      temperature_2m_min: [0, 2, 4],
      rain_sum: [0, 0, 0],
      showers_sum: [0, 0, 0],
      snowfall_sum: [0, 0, 0],
      wind_speed_10m_max: [1, 1, 1],
      wind_direction_10m_dominant: [1, 1, 1],
    },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-08-21T12:00:00+00:00");
});

test("buildForecastEntries: missing wind values -> wind object present without the non-finite fields", () => {
  const [entry] = buildForecastEntries({
    timezone: "UTC",
    daily: {
      time: ["2026-08-20"],
      temperature_2m_max: [10],
      temperature_2m_min: [0],
      rain_sum: [0],
      showers_sum: [0],
      snowfall_sum: [0],
      wind_speed_10m_max: [null as unknown as number],
      wind_direction_10m_dominant: undefined,
    },
  });
  assert.ok(entry.wind);
  assert.equal("speed" in entry.wind, false);
  assert.equal("direction" in entry.wind, false);
});

test("fetchDailyForecasts: 51 targets -> 2 requests, correct URL params, index alignment", async () => {
  const targets: WeatherTarget[] = Array.from({ length: 51 }, (_, i) => ({
    id: `dest-${i}`,
    lat: 40 + i,
    lng: -120 - i,
  }));
  assert.equal(LOCATION_BATCH_SIZE, 50);

  const chunk1 = Array.from({ length: 50 }, (_, i) => dailyResultFor(i === 1 ? 99 : 10));
  const chunk2 = [dailyResultFor(20)];
  const { fn, calls } = fakeFetch([
    { status: 200, body: chunk1 },
    { status: 200, body: chunk2 },
  ]);

  const forecasts = await fetchDailyForecasts(targets, fn);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call, /temperature_2m_max/);
    assert.match(call, /temperature_2m_min/);
    assert.match(call, /rain_sum/);
    assert.match(call, /showers_sum/);
    assert.match(call, /snowfall_sum/);
    assert.match(call, /wind_speed_10m_max/);
    assert.match(call, /wind_direction_10m_dominant/);
    assert.match(call, new RegExp(`forecast_days=${FORECAST_DAYS}`));
    assert.match(call, /timezone=auto/);
    assert.match(call, /windspeed_unit=ms/);
  }
  // Comma-joined coords, request order.
  assert.match(calls[0], /latitude=40,41,42/);
  assert.match(calls[0], /longitude=-120,-121,-122/);
  assert.match(calls[1], /latitude=90(&|$)/);

  // Index alignment: the 2nd target in the batch gets the 2nd result.
  const second = forecasts.get(targets[1].id);
  assert.equal(second?.[0].temperatureMax, 372.15); // 99 + 273.15

  // The single target in the 2nd batch gets that batch's only result.
  const last = forecasts.get(targets[50].id);
  assert.equal(last?.[0].temperatureMax, 293.15); // 20 + 273.15
});

test("fetchDailyForecasts: one failing batch (500) leaves the other batch's results intact", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const targets: WeatherTarget[] = [
    ...Array.from({ length: 50 }, (_, i) => ({ id: `fail-${i}`, lat: 1 + i, lng: 1 + i })),
    { id: "ok-0", lat: 99, lng: 99 },
  ];
  const { fn } = fakeFetch([
    { status: 500, body: {} },
    { status: 200, body: [dailyResultFor(15)] },
  ]);

  const forecasts = await fetchDailyForecasts(targets, fn);

  assert.equal(forecasts.has("fail-0"), false);
  assert.equal(forecasts.get("ok-0")?.[0].temperatureMax, 288.15); // 15 + 273.15
});

test("fetchDailyForecasts: bare-object single-location response is wrapped", async () => {
  const targets: WeatherTarget[] = [{ id: "solo", lat: 10, lng: 20 }];
  const { fn } = fakeFetch([{ status: 200, body: dailyResultFor(5) }]);

  const forecasts = await fetchDailyForecasts(targets, fn);

  assert.equal(forecasts.get("solo")?.[0].temperatureMax, 278.15); // 5 + 273.15
});

// --- refreshDestinationWeather: fake pool + fake Firestore db -------------
//
// No real DB or Firestore SDK involved. `pool` is a fake exposing only
// `.query()` (same pattern as sweep-stuck-sessions.test.ts's fakePool). The
// fake `db` implements just the surface refreshDestinationWeather touches:
// `collection().select().get()` for the legacy doc-id scan, `collection().doc()`
// for a fresh doc ref, and `bulkWriter()` with `onWriteError`/`set`/`delete`/
// `close` — `set`/`delete` return real Promises so the module's own
// `.then()/.catch()` settling logic runs exactly as it does against the real
// SDK, and `set()` can be told to fail for chosen destinationIds to exercise
// the onWriteError path without a real BulkWriterError.

function fakePool(rows: WeatherTarget[]): Pool {
  return { query: async () => ({ rows }) } as unknown as Pool;
}

function makeFakeDb(
  legacyDocs: Array<{ id: string; destinationId: string }>,
  opts: { failDestinationIds?: Set<string> } = {}
) {
  const setCalls: Array<{ refPath: string; data: Record<string, unknown> }> = [];
  const deletedPaths: string[] = [];
  const writeErrors: unknown[] = [];
  let errorFn: ((error: unknown) => boolean) | null = null;

  const makeRef = (path: string) => ({ path });
  const legacyRefs = legacyDocs.map((doc) => ({
    ref: makeRef(`weather/${doc.id}`),
    destinationId: doc.destinationId,
  }));

  const weatherCollection = {
    select: (_field: string) => ({
      get: async () => ({
        docs: legacyRefs.map(({ ref, destinationId }) => ({
          ref,
          get: (field: string) => (field === "destinationId" ? destinationId : undefined),
        })),
      }),
    }),
    doc: (id: string) => makeRef(`weather/new-${id}`),
  };

  const db = {
    collection: (name: string) => {
      assert.equal(name, "weather");
      return weatherCollection;
    },
    bulkWriter: () => ({
      onWriteError: (fn: (error: unknown) => boolean) => {
        errorFn = fn;
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        setCalls.push({ refPath: ref.path, data });
        if (opts.failDestinationIds?.has(data.destinationId as string)) {
          const error = {
            code: 14,
            message: "simulated permanent failure",
            documentRef: ref,
            operationType: "set" as const,
            failedAttempts: 1,
          };
          writeErrors.push(error);
          errorFn?.(error);
          return Promise.reject(new Error("simulated write failure"));
        }
        return Promise.resolve({});
      },
      delete: (ref: { path: string }) => {
        deletedPaths.push(ref.path);
        return Promise.resolve({});
      },
      close: async () => {},
    }),
  };

  return { db: db as unknown as Firestore, setCalls, deletedPaths, writeErrors };
}

test("refreshDestinationWeather: dedupes legacy docs by destinationId, reuses the first ref, deletes extras, writes the full doc shape", async () => {
  const targets: WeatherTarget[] = [
    { id: "dest-a", lat: 1, lng: 1 },
    { id: "dest-b", lat: 2, lng: 2 },
    { id: "dest-c", lat: 3, lng: 3 }, // no legacy doc at all
  ];
  const { db, setCalls, deletedPaths } = makeFakeDb([
    { id: "legacy-1", destinationId: "dest-a" },
    { id: "legacy-2", destinationId: "dest-a" }, // duplicate -> must be deleted
    { id: "legacy-3", destinationId: "dest-b" },
  ]);
  const { fn } = fakeFetch([
    { status: 200, body: [dailyResultFor(10), dailyResultFor(20), dailyResultFor(30)] },
  ]);

  const counts = await refreshDestinationWeather(fakePool(targets), db, fn);

  assert.deepEqual(counts, { total: 3, refreshed: 3, skipped: 0 });
  assert.deepEqual(deletedPaths, ["weather/legacy-2"]);

  const byDestination = new Map(setCalls.map((c) => [c.data.destinationId, c]));
  assert.equal(byDestination.get("dest-a")?.refPath, "weather/legacy-1"); // first-doc-wins, reused
  assert.equal(byDestination.get("dest-b")?.refPath, "weather/legacy-3"); // sole legacy doc, reused
  assert.equal(byDestination.get("dest-c")?.refPath, "weather/new-dest-c"); // no legacy doc -> fresh ref

  const destAWrite = byDestination.get("dest-a")!;
  assert.equal(destAWrite.data.destinationId, "dest-a");
  assert.ok(Array.isArray(destAWrite.data.forecast));
  assert.ok((destAWrite.data.forecast as unknown[]).length > 0);
  assert.equal(destAWrite.data.lastUpdated, FieldValue.serverTimestamp());
});

test("refreshDestinationWeather: a write BulkWriter ultimately fails is logged via onWriteError and excluded from refreshed", async (t) => {
  const warnMock = t.mock.method(console, "warn", () => undefined);
  const targets: WeatherTarget[] = [
    { id: "dest-a", lat: 1, lng: 1 },
    { id: "dest-b", lat: 2, lng: 2 },
  ];
  const { db, writeErrors } = makeFakeDb([], { failDestinationIds: new Set(["dest-a"]) });
  const { fn } = fakeFetch([{ status: 200, body: [dailyResultFor(10), dailyResultFor(20)] }]);

  const counts = await refreshDestinationWeather(fakePool(targets), db, fn);

  assert.deepEqual(counts, { total: 2, refreshed: 1, skipped: 1 });
  assert.equal(writeErrors.length, 1, "onWriteError must have been invoked for the failing write");
  assert.ok(
    warnMock.mock.calls.some((call) => String(call.arguments[0]).includes("write failed")),
    "the failure must be logged, not silently dropped"
  );
});

test("POST /internal/weather-refresh without a bearer token is rejected (mirrors sweep)", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const res = await request(app).post("/internal/weather-refresh");
  assert.equal(res.status, 401);
});
