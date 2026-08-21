import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mergeHealthData, mergeSourceContributions } from "../session-enrichment";

test("mergeSourceContributions preserves existing entries and unions duplicate contribution types", () => {
  const existing = [{
    source: "strava",
    external_id: "123",
    original_start_date: "2026-05-01T00:00:00Z",
    original_end_date: "2026-05-01T01:00:00Z",
    fragment_start_date: "2026-05-01T00:00:00Z",
    fragment_end_date: "2026-05-01T01:00:00Z",
    contribution_types: ["stats"],
    summary: { calories: 300 },
  }];
  const incoming = [{
    source: "strava",
    external_id: "123",
    original_start_date: "2026-05-01T00:00:00Z",
    original_end_date: "2026-05-01T01:00:00Z",
    fragment_start_date: "2026-05-01T00:00:00Z",
    fragment_end_date: "2026-05-01T01:00:00Z",
    contribution_types: ["gps_gap", "health"],
  }, {
    source: "apple-health",
    external_id: "456",
    original_start_date: "2026-05-02T00:00:00Z",
    fragment_start_date: "2026-05-02T00:00:00Z",
    contribution_types: ["health"],
  }];

  const merged = mergeSourceContributions(existing, incoming);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].contribution_types, ["gps_gap", "health", "stats"]);
  assert.deepEqual(merged[0].summary, { calories: 300 });
  assert.equal(merged[1].external_id, "456");
});

test("mergeSourceContributions collapses drifted windows of the same activity to the widest", () => {
  const existing = [{
    source: "strava",
    external_id: "10829912049",
    fragment_start_date: "2024-02-24T17:25:45Z",
    fragment_end_date: "2024-02-24T19:55:23Z",
    contribution_types: ["gps_gap"],
  }];
  const incoming = [{
    source: "strava",
    external_id: "10829912049",
    fragment_start_date: "2024-02-24T17:25:03Z",
    fragment_end_date: "2024-02-24T19:56:05Z",
    contribution_types: ["health", "stats"],
  }];

  const merged = mergeSourceContributions(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].fragment_start_date, "2024-02-24T17:25:03Z");
  assert.equal(merged[0].fragment_end_date, "2024-02-24T19:56:05Z");
  assert.deepEqual(merged[0].contribution_types, ["gps_gap", "health", "stats"]);
});

test("mergeSourceContributions keeps the earlier imported_at, not whichever side spread last", () => {
  const existing = [{
    source: "strava",
    external_id: "10829912049",
    fragment_start_date: "2024-02-24T17:25:45Z",
    imported_at: "2024-02-25T09:00:00Z",
    contribution_types: ["gps_gap"],
  }];
  const incoming = [{
    source: "strava",
    external_id: "10829912049",
    fragment_start_date: "2024-02-24T17:25:03Z",
    imported_at: "2024-03-01T12:00:00Z",
    contribution_types: ["health"],
  }];

  const merged = mergeSourceContributions(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].imported_at, "2024-02-25T09:00:00Z");
});

test("mergeSourceContributions omits undefined optional fields as own keys, not just as values", () => {
  const existing = [{ source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:00Z", contribution_types: ["gps_gap"] }];
  const incoming = [{ source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:00Z", contribution_types: ["health"] }];

  const merged = mergeSourceContributions(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal("imported_at" in merged[0], false);
  assert.equal("summary" in merged[0], false);
  assert.equal("original_start_date" in merged[0], false);
});

test("mergeSourceContributions collapses legacy duplicates already in the stored list", () => {
  const existing = [
    { source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:40Z", fragment_end_date: "2024-01-01T15:27:10Z", contribution_types: ["gps_gap"] },
    { source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:05Z", fragment_end_date: "2024-01-01T15:27:47Z", contribution_types: ["health"] },
  ];

  const merged = mergeSourceContributions(existing, []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].fragment_start_date, "2024-01-01T10:00:05Z");
  assert.equal(merged[0].fragment_end_date, "2024-01-01T15:27:47Z");
});

test("mergeSourceContributions keeps different activities separate", () => {
  const existing = [{ source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:00Z", contribution_types: ["gps_gap"] }];
  const incoming = [{ source: "strava", external_id: "222", fragment_start_date: "2024-01-01T10:00:00Z", contribution_types: ["gps_gap"] }];

  assert.equal(mergeSourceContributions(existing, incoming).length, 2);
});

test("mergeSourceContributions treats a missing fragment end as open-ended", () => {
  const existing = [{ source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:00Z", fragment_end_date: "2024-01-01T15:00:00Z", contribution_types: ["gps_gap"] }];
  const incoming = [{ source: "strava", external_id: "111", fragment_start_date: "2024-01-01T10:00:00Z", contribution_types: ["gps_gap"] }];

  const merged = mergeSourceContributions(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].fragment_end_date, undefined);
});

test("mergeHealthData keeps existing samples and adds incoming missing timestamps", () => {
  const existing = {
    calories: [
      { date: "2026-05-01T00:00:00Z", calories: 100 },
    ],
    heartRates: [
      { date: "2026-05-01T00:00:00Z", heartRate: 120 },
    ],
  };
  const incoming = {
    calories: [
      { date: "2026-05-01T00:00:00Z", calories: 999 },
      { date: "2026-05-01T00:01:00Z", calories: 110 },
    ],
    heartRates: [
      { date: "2026-05-01T00:00:00Z", heartRate: 199 },
      { date: "2026-05-01T00:01:00Z", heartRate: 121 },
    ],
  };

  const merged = mergeHealthData(existing, incoming);

  assert.deepEqual(merged?.calories, [
    { date: "2026-05-01T00:00:00Z", calories: 100 },
    { date: "2026-05-01T00:01:00Z", calories: 110 },
  ]);
  assert.deepEqual(merged?.heartRates, [
    { date: "2026-05-01T00:00:00Z", heartRate: 120 },
    { date: "2026-05-01T00:01:00Z", heartRate: 121 },
  ]);
});

test("mergeHealthData preserves legacy snake-case heart-rate samples", () => {
  const existing = {
    heart_rates: [
      { date: "2026-05-01T00:00:00Z", heart_rate: 120 },
    ],
  };
  const incoming = {
    heartRates: [
      { date: "2026-05-01T00:01:00Z", heartRate: 121 },
    ],
  };

  const merged = mergeHealthData(existing, incoming);

  assert.deepEqual(merged?.heartRates, [
    { date: "2026-05-01T00:00:00Z", heartRate: 120 },
    { date: "2026-05-01T00:01:00Z", heartRate: 121 },
  ]);
});
