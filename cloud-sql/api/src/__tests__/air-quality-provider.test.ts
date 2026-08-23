import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AirQualityRequestAbortedError,
  CachedAirQualityProvider,
  classifyAirQualityFreshness,
  createProductionAirQualityProvider,
} from "../air-quality-provider";
import {
  FixtureAirQualityProvider,
  fixtureReportingArea,
} from "./helpers/air-quality-fixture-provider";

const UPDATED_AT = "2026-08-23T20:00:00.000Z";
const FETCHED_AT = "2026-08-23T20:05:00.000Z";

function dataResult(updatedAt: string | null = UPDATED_AT) {
  return {
    kind: "data" as const,
    reportingAreas: [fixtureReportingArea()],
    updatedAt,
    fetchedAt: FETCHED_AT,
  };
}

test("production factory stays disabled and can never select fixtures", async () => {
  assert.deepEqual(await createProductionAirQualityProvider({}).load(), {
    kind: "disabled",
    reason: "owner_notice_required",
  });
  assert.deepEqual(
    await createProductionAirQualityProvider({ AIR_QUALITY_LIVE_ENABLED: "fixture" }).load(),
    { kind: "disabled", reason: "owner_notice_required" }
  );
  assert.deepEqual(
    await createProductionAirQualityProvider({ AIR_QUALITY_LIVE_ENABLED: "true" }).load(),
    { kind: "disabled", reason: "live_provider_not_ready" }
  );
});

test("freshness turns stale at the exact source-age boundary", () => {
  const updatedAtMs = Date.parse(UPDATED_AT);
  const staleAfterMs = 2 * 60 * 60 * 1000;
  assert.deepEqual(classifyAirQualityFreshness(UPDATED_AT, updatedAtMs + staleAfterMs - 1, staleAfterMs), {
    status: "fresh",
    staleAfter: "2026-08-23T22:00:00.000Z",
  });
  assert.equal(
    classifyAirQualityFreshness(UPDATED_AT, updatedAtMs + staleAfterMs, staleAfterMs).status,
    "stale"
  );
  assert.deepEqual(classifyAirQualityFreshness("not-a-date", updatedAtMs, staleAfterMs), {
    status: "stale",
    staleAfter: null,
  });
  assert.deepEqual(classifyAirQualityFreshness(null, updatedAtMs, staleAfterMs), {
    status: "stale",
    staleAfter: null,
  });
});

test("cache honors TTL and refetches after expiry", async () => {
  let now = Date.parse(UPDATED_AT) + 1_000;
  const fixture = new FixtureAirQualityProvider(() => dataResult());
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 100,
    staleRetentionMs: 10_000,
    nowMs: () => now,
  });
  await cache.load();
  await cache.load();
  assert.equal(fixture.callCount, 1);
  now += 101;
  await cache.load();
  assert.equal(fixture.callCount, 2);
});

test("cache coalesces concurrent loads", async () => {
  const now = Date.parse(UPDATED_AT) + 1_000;
  let resolve!: (value: ReturnType<typeof dataResult>) => void;
  const pending = new Promise<ReturnType<typeof dataResult>>((done) => {
    resolve = done;
  });
  const fixture = new FixtureAirQualityProvider(() => pending);
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 100,
    staleRetentionMs: 10_000,
    nowMs: () => now,
  });

  const first = cache.load();
  const second = cache.load();
  assert.equal(fixture.callCount, 1);
  resolve(dataResult());
  assert.deepEqual(await first, await second);
});

test("one canceled waiter does not cancel the shared load or poison the cache", async () => {
  const now = Date.parse(UPDATED_AT) + 1_000;
  let resolve!: (value: ReturnType<typeof dataResult>) => void;
  const pending = new Promise<ReturnType<typeof dataResult>>((done) => {
    resolve = done;
  });
  const fixture = new FixtureAirQualityProvider(() => pending);
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 1_000,
    staleRetentionMs: 10_000,
    nowMs: () => now,
  });
  const controller = new AbortController();
  const canceled = cache.load(controller.signal);
  const survivor = cache.load();
  controller.abort();
  await assert.rejects(canceled, AirQualityRequestAbortedError);
  resolve(dataResult());
  assert.equal((await survivor).kind, "data");
  assert.equal((await cache.load()).kind, "data");
  assert.equal(fixture.callCount, 1);
});

test("cache serves retained data as stale on a transient refresh failure", async () => {
  let now = Date.parse(UPDATED_AT) + 1_000;
  const fixture = new FixtureAirQualityProvider((call) =>
    call === 1
      ? dataResult()
      : { kind: "error", reason: "upstream_unavailable", retryable: true }
  );
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 100,
    staleRetentionMs: 10_000,
    nowMs: () => now,
  });
  await cache.load();
  now += 101;
  const fallback = await cache.load();
  assert.equal(fallback.kind, "data");
  if (fallback.kind === "data") assert.equal(fallback.forceStale, true);
});

test("cache serves retained data as stale when refresh throws", async () => {
  let now = Date.parse(UPDATED_AT) + 1_000;
  const fixture = new FixtureAirQualityProvider((call) => {
    if (call === 1) return dataResult();
    throw new Error("connection reset");
  });
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 100,
    staleRetentionMs: 10_000,
    nowMs: () => now,
  });
  await cache.load();
  now += 101;
  const fallback = await cache.load();
  assert.equal(fallback.kind, "data");
  if (fallback.kind === "data") assert.equal(fallback.forceStale, true);
});

test("fresh TTL expires data at the exact hard source-age limit", async () => {
  let now = Date.parse(FETCHED_AT);
  const retentionMs = 6 * 60 * 60 * 1000;
  const oneMillisecondInside = new Date(now - retentionMs + 1).toISOString();
  const fixture = new FixtureAirQualityProvider(() => dataResult(oneMillisecondInside));
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 100,
    staleRetentionMs: retentionMs,
    nowMs: () => now,
  });
  assert.equal((await cache.load()).kind, "data", "data younger than six hours remains valid");
  now += 1;
  const result = await cache.load();
  assert.deepEqual(result, {
    kind: "error",
    reason: "upstream_invalid",
    retryable: true,
  });
  assert.equal(fixture.callCount, 2, "expired source bypasses the otherwise-fresh cache");
});

test("cache rejects no-data without a trustworthy source time or at the hard limit", async () => {
  const now = Date.parse(FETCHED_AT);
  const retentionMs = 6 * 60 * 60 * 1000;
  const updatedAtValues = [
    new Date(now - retentionMs).toISOString(),
    new Date(now + 1).toISOString(),
    "not-a-date",
    null,
  ];

  for (const updatedAt of updatedAtValues) {
    const fixture = new FixtureAirQualityProvider(() => ({
      kind: "no_data",
      updatedAt,
      fetchedAt: FETCHED_AT,
    }));
    const cache = new CachedAirQualityProvider(fixture, {
      freshTtlMs: 20 * 60 * 1000,
      staleRetentionMs: retentionMs,
      nowMs: () => now,
    });

    assert.deepEqual(await cache.load(), {
      kind: "error",
      reason: "upstream_invalid",
      retryable: true,
    });
    assert.deepEqual(await cache.load(), {
      kind: "error",
      reason: "upstream_invalid",
      retryable: true,
    });
    assert.equal(fixture.callCount, 2, `invalid no-data result was cached: ${updatedAt}`);
  }
});

test("unknown source time is stale, is never cached, and never uses fetch time", async () => {
  const now = Date.parse(FETCHED_AT);
  const fixture = new FixtureAirQualityProvider(() => dataResult(null));
  const cache = new CachedAirQualityProvider(fixture, {
    freshTtlMs: 20 * 60 * 1000,
    staleRetentionMs: 6 * 60 * 60 * 1000,
    nowMs: () => now,
  });
  const first = await cache.load();
  const second = await cache.load();
  assert.equal(first.kind, "data");
  assert.equal(second.kind, "data");
  if (first.kind === "data") assert.equal(first.forceStale, true);
  assert.equal(fixture.callCount, 2);
});
