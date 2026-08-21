// weather-refresh: pure mapper + batching tests, no network and no Firestore
// init (fetch is injected; refreshDestinationWeather/selectWeatherTargets are
// exercised through their own integration paths, not here). The endpoint auth
// test hits the exported `app` directly with supertest, mirroring sweep's
// contract test in route-error-handling.test.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import request from "supertest";
import { app } from "../index";
import {
  buildForecastEntries,
  fetchDailyForecasts,
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

test("POST /internal/weather-refresh without a bearer token is rejected (mirrors sweep)", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const res = await request(app).post("/internal/weather-refresh");
  assert.equal(res.status, 401);
});
