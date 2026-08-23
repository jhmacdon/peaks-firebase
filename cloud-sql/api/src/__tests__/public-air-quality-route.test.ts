import { strict as assert } from "node:assert";
import { test } from "node:test";
import express from "express";
import request from "supertest";
import {
  createPublicAirQualityRouter,
  parseAirQualityViewport,
} from "../routes/public-air-quality";
import {
  FixtureAirQualityProvider,
  fixtureReportingArea,
} from "./helpers/air-quality-fixture-provider";

const NOW = Date.parse("2026-08-23T21:00:00.000Z");
const PATH =
  "/public/air-quality/viewport?west=-122.4&south=47.5&east=-122.2&north=47.7&zoom=10";

function appWith(provider: FixtureAirQualityProvider) {
  const app = express();
  app.use(
    "/public/air-quality",
    createPublicAirQualityRouter(provider, { nowMs: () => NOW })
  );
  return app;
}

function dataResult(updatedAt: string | null = "2026-08-23T20:00:00.000Z") {
  return {
    kind: "data" as const,
    reportingAreas: [
      fixtureReportingArea(),
      fixtureReportingArea({
        id: "airnow:wa:yakima",
        name: "Yakima",
        geometry: { type: "Point", coordinates: [-120.5059, 46.6021] },
      }),
    ],
    updatedAt,
    fetchedAt: "2026-08-23T20:05:00.000Z",
  };
}

test("fresh public response needs no auth and filters to the quantized viewport", async () => {
  const provider = new FixtureAirQualityProvider(() => dataResult());
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "fresh");
  assert.deepEqual(res.body.viewport, {
    west: -122.4,
    south: 47.5,
    east: -122.2,
    north: 47.7,
    zoom: 10,
    quantizationDegrees: 0.1,
  });
  assert.equal(res.body.reportingAreas.length, 1);
  assert.equal(res.body.reportingAreas[0].kind, "reporting_area");
  assert.deepEqual(res.body.reportingAreas[0].geometry, {
    type: "Point",
    coordinates: [-122.3321, 47.6062],
  });
  assert.deepEqual(res.body.reportingAreas[0].category, {
    id: "moderate",
    label: "Moderate",
    sourceValue: "Moderate",
  });
  assert.equal(res.body.source.id, "airnow");
  assert.equal(
    res.body.source.attribution,
    "Participating air agencies and U.S. EPA AirNow • Preliminary"
  );
  assert.equal(res.body.source.preliminary, true);
  assert.equal(res.body.source.precision, "reporting_area_centroid");
  assert.equal(res.body.source.coverageRegion, "US");
  assert.equal(res.body.source.standard, "us_epa_aqi");
  assert.deepEqual(res.body.source.fileRefreshMinutesPastHour, [10, 25, 40]);
  assert.equal(res.body.source.observationCadence, "hourly");
  assert.equal(res.body.updatedAt, "2026-08-23T20:00:00.000Z");
  assert.equal(res.body.staleAfter, "2026-08-23T22:00:00.000Z");
  assert.equal(res.body.reason, null);
});

test("old source data has a typed stale envelope", async () => {
  const provider = new FixtureAirQualityProvider(() =>
    dataResult("2026-08-23T18:59:59.000Z")
  );
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "stale");
  assert.match(res.headers["cache-control"], /no-cache/);
});

test("unknown source time is stale and never replaced with fetch time", async () => {
  const provider = new FixtureAirQualityProvider(() => dataResult(null));
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "stale");
  assert.equal(res.body.updatedAt, null);
  assert.equal(res.body.staleAfter, null);
});

test("empty viewport has a typed no-data envelope", async () => {
  const provider = new FixtureAirQualityProvider(() => dataResult());
  const res = await request(appWith(provider)).get(
    "/public/air-quality/viewport?west=-121&south=47&east=-120.9&north=47.1&zoom=10"
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "no_data");
  assert.deepEqual(res.body.reportingAreas, []);
  assert.equal(res.body.source.precision, "reporting_area_centroid");
});

test("provider no-data result keeps its source update time", async () => {
  const provider = new FixtureAirQualityProvider(() => ({
    kind: "no_data",
    updatedAt: "2026-08-23T20:00:00.000Z",
    fetchedAt: "2026-08-23T20:05:00.000Z",
  }));
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "no_data");
  assert.equal(res.body.updatedAt, "2026-08-23T20:00:00.000Z");
  assert.equal(res.body.staleAfter, "2026-08-23T22:00:00.000Z");
});

test("source-backed results expire at six hours and invalid no-data fails closed", async () => {
  const expiredAt = "2026-08-23T15:00:00.000Z";
  const providers = [
    new FixtureAirQualityProvider(() => dataResult(expiredAt)),
    new FixtureAirQualityProvider(() => ({
      kind: "no_data",
      updatedAt: expiredAt,
      fetchedAt: "2026-08-23T20:05:00.000Z",
    })),
    new FixtureAirQualityProvider(() => ({
      kind: "no_data",
      updatedAt: null,
      fetchedAt: "2026-08-23T20:05:00.000Z",
    })),
  ];

  for (const provider of providers) {
    const res = await request(appWith(provider)).get(PATH);
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "error");
    assert.equal(res.body.reason, "upstream_invalid");
    assert.equal(res.body.retryable, true);
    assert.equal(res.headers["cache-control"], "no-store");
  }
});

test("stale no-data responses require cache revalidation", async () => {
  const provider = new FixtureAirQualityProvider(() => ({
    kind: "no_data",
    updatedAt: "2026-08-23T18:59:59.000Z",
    fetchedAt: "2026-08-23T20:05:00.000Z",
  }));
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "no_data");
  assert.equal(res.headers["cache-control"], "no-cache");
});

test("disabled provider is a typed 503 and never asks for auth", async () => {
  const provider = new FixtureAirQualityProvider(() => ({
    kind: "disabled",
    reason: "owner_notice_required",
  }));
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 503);
  assert.equal(res.body.status, "disabled");
  assert.equal(res.body.reason, "owner_notice_required");
  assert.deepEqual(res.body.reportingAreas, []);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("rate limit and upstream errors have distinct typed envelopes", async () => {
  const limited = new FixtureAirQualityProvider(() => ({
    kind: "rate_limited",
    retryAfterSeconds: 120,
  }));
  const limitedRes = await request(appWith(limited)).get(PATH);
  assert.equal(limitedRes.status, 429);
  assert.equal(limitedRes.body.status, "rate_limited");
  assert.equal(limitedRes.body.retryAfterSeconds, 120);
  assert.equal(limitedRes.headers["retry-after"], "120");

  const failed = new FixtureAirQualityProvider(() => ({
    kind: "error",
    reason: "upstream_invalid",
    retryable: false,
  }));
  const failedRes = await request(appWith(failed)).get(PATH);
  assert.equal(failedRes.status, 503);
  assert.equal(failedRes.body.status, "error");
  assert.equal(failedRes.body.reason, "upstream_invalid");
  assert.equal(failedRes.body.retryable, false);
});

test("provider throws become typed retryable errors", async () => {
  const provider = new FixtureAirQualityProvider(() => {
    throw new Error("network down");
  });
  const res = await request(appWith(provider)).get(PATH);
  assert.equal(res.status, 503);
  assert.equal(res.body.status, "error");
  assert.equal(res.body.reason, "upstream_unavailable");
  assert.equal(res.body.retryable, true);
});

test("strict validation rejects arrays, wrapping boxes, large views, and invalid zoom", async () => {
  const provider = new FixtureAirQualityProvider(() => dataResult());
  const paths = [
    "/public/air-quality/viewport?west=-123&west=-122&south=47&east=-121&north=48&zoom=8",
    "/public/air-quality/viewport?west=170&south=47&east=-170&north=48&zoom=8",
    "/public/air-quality/viewport?west=-170&south=10&east=-80&north=60&zoom=10",
    "/public/air-quality/viewport?west=-123&south=47&east=-122&north=48&zoom=3",
    "/public/air-quality/viewport?west=-123junk&south=47&east=-122&north=48&zoom=8",
    "/public/air-quality/viewport?west=-122.39&south=47.55&east=-122.25&north=47.67&zoom=10",
  ];
  for (const path of paths) {
    const res = await request(appWith(provider)).get(path);
    assert.equal(res.status, 400, path);
    assert.equal(res.body.status, "error");
    assert.equal(res.body.error.code, "invalid_viewport");
  }
  assert.equal(provider.callCount, 0);
});

test("zoom 4 through 14 use the client contract's golden aligned span caps", () => {
  const caps: Array<[zoom: number, longitude: number, latitude: number]> = [
    [4, 90.0, 60.0],
    [5, 45.0, 33.7],
    [6, 22.5, 16.8],
    [7, 11.2, 8.4],
    [8, 5.6, 4.2],
    [9, 2.8, 2.1],
    [10, 1.4, 1.0],
    [11, 0.7, 0.5],
    [12, 0.3, 0.2],
    [13, 0.2, 0.2],
    [14, 0.2, 0.2],
  ];

  const parse = (zoom: number, east: number, north: number) =>
    parseAirQualityViewport({
      west: "0.0",
      south: "0.0",
      east: east.toFixed(1),
      north: north.toFixed(1),
      zoom: String(zoom),
    });

  for (const [zoom, longitude, latitude] of caps) {
    assert.equal(parse(zoom, longitude, 0.1).ok, true, `z${zoom} longitude cap`);
    assert.equal(parse(zoom, longitude + 0.1, 0.1).ok, false, `z${zoom} longitude overflow`);
    assert.equal(parse(zoom, 0.1, latitude).ok, true, `z${zoom} latitude cap`);
    assert.equal(parse(zoom, 0.1, latitude + 0.1).ok, false, `z${zoom} latitude overflow`);
  }
});
