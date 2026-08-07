// Open-Meteo CAMS client: URL shape, response mapping, TTL cache, and
// failure → null (the endpoint degrades, never throws upstream errors).

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { fetchCams, clearCamsCache } from "../open-meteo";

const BODY = {
  timezone: "America/New_York",
  utc_offset_seconds: -14400,
  hourly: { time: [1754452800], pm2_5: [5.2], us_aqi: [40] },
};

function fakeFetch(status = 200, body: unknown = BODY) {
  const calls: string[] = [];
  const fn = (async (url: any) => {
    calls.push(String(url));
    return {
      ok: status === 200,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

beforeEach(() => clearCamsCache());

test("fetchCams requests pm2_5+us_aqi unixtime for 7 days and maps the body", async () => {
  const { fn, calls } = fakeFetch();
  const data = await fetchCams(44.28, -71.31, fn);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /air-quality-api\.open-meteo\.com/);
  assert.match(calls[0], /hourly=pm2_5,us_aqi/);
  assert.match(calls[0], /forecast_days=7/);
  assert.match(calls[0], /timeformat=unixtime/);
  assert.match(calls[0], /timezone=auto/);
  assert.equal(data!.timezone, "America/New_York");
  assert.equal(data!.utcOffsetSeconds, -14400);
  assert.deepEqual(data!.timesSec, [1754452800]);
  assert.deepEqual(data!.pm25, [5.2]);
  assert.deepEqual(data!.usAqi, [40]);
});

test("fetchCams caches by location within the TTL", async () => {
  const { fn, calls } = fakeFetch();
  let now = 1_000_000;
  const clock = () => now;
  await fetchCams(44.28, -71.31, fn, clock);
  await fetchCams(44.28, -71.31, fn, clock);
  assert.equal(calls.length, 1, "second call must hit the cache");
  now += 61 * 60 * 1000; // past the 60 min TTL
  await fetchCams(44.28, -71.31, fn, clock);
  assert.equal(calls.length, 2, "expired entry must refetch");
});

test("fetchCams returns null on non-200 and does not cache failures", async () => {
  const { fn, calls } = fakeFetch(500);
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
  assert.equal(calls.length, 2, "failures are not cached");
});

test("fetchCams returns null on malformed body", async () => {
  const { fn } = fakeFetch(200, { nope: true });
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
});

test("fetchCams returns null when fetch throws", async () => {
  const fn = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.equal(await fetchCams(44.28, -71.31, fn), null);
});
