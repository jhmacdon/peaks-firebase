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
