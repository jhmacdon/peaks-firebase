import assert from "node:assert/strict";
import test from "node:test";

import {
  amenityRows,
  buildDestinationGuide,
  describeDestinationType,
  describeSessionNoun,
  formatDistanceAway,
  formatElapsed,
  formatFeetValue,
  formatMilesValue,
  monthlyVisitCounts,
  peakMonthIndexes,
  reportPreview,
  titleize,
} from "./destination-detail";

test("describeDestinationType prefers the primary feature, titleized", () => {
  assert.equal(describeDestinationType("point", ["summit"]), "Summit");
  assert.equal(describeDestinationType("point", ["fire-lookout"]), "Fire lookout");
});

test("describeDestinationType falls back to Region for a region with no features", () => {
  assert.equal(describeDestinationType("region", []), "Region");
});

test("describeDestinationType omits (null) a generic point with no features", () => {
  assert.equal(describeDestinationType("point", []), null);
});

const BASE_SOURCE = {
  name: "Test Peak",
  type: "point",
  elevation: 1200,
  prominence: 400,
  activities: [] as string[],
  features: ["summit"] as string[],
};

test("buildDestinationGuide headline omits elevation and prominence (already in the stat row)", () => {
  const guide = buildDestinationGuide(BASE_SOURCE, "Washington, United States", 0);
  assert.equal(guide.headline, "Test Peak is a summit in Washington, United States.");
});

test("buildDestinationGuide drops the activity claim when there are no recorded sessions", () => {
  const source = { ...BASE_SOURCE, activities: ["outdoor-trek"] };
  const withoutSessions = buildDestinationGuide(source, null, 0);
  assert.ok(
    !withoutSessions.paragraphs.some((p) => p.includes("activity recorded here")),
    "should not claim recorded activity with zero sessions"
  );

  const withSessions = buildDestinationGuide(source, null, 5);
  assert.ok(
    withSessions.paragraphs.some((p) => p.includes("activity recorded here is hiking")),
    "should claim recorded activity once there are sessions"
  );
});

test("formatFeetValue returns a bare numeral, and null rather than a placeholder", () => {
  assert.equal(formatFeetValue(4392), "14,409");
  assert.equal(formatFeetValue(null), null);
  assert.equal(formatFeetValue(undefined), null);
});

test("formatMilesValue returns one decimal place, and null for missing input", () => {
  assert.equal(formatMilesValue(1609.34), "1.0");
  assert.equal(formatMilesValue(null), null);
});

test("formatElapsed drops the hour part below an hour", () => {
  assert.equal(formatElapsed(3600 * 3 + 60 * 12), "3h 12m");
  assert.equal(formatElapsed(60 * 48), "48m");
  assert.equal(formatElapsed(0), "0m");
});

test("formatDistanceAway switches from metres to miles at a mile", () => {
  assert.equal(formatDistanceAway(820), "820 m away");
  assert.equal(formatDistanceAway(1411), "1,411 m away");
  assert.equal(formatDistanceAway(5471), "3.4 mi away");
});

test("titleize turns a raw enum into a word", () => {
  assert.equal(titleize("fire-lookout"), "Fire lookout");
  assert.equal(titleize("summit"), "Summit");
});

test("describeSessionNoun only says Ascents for something you climb", () => {
  assert.equal(describeSessionNoun(["summit", "volcano"]), "Ascents");
  assert.equal(describeSessionNoun(["volcano"]), "Ascents");
  assert.equal(describeSessionNoun(["lake"]), "Sessions");
  assert.equal(describeSessionNoun([]), "Sessions");
});

test("monthlyVisitCounts folds every month spelling onto twelve Jan-first slots", () => {
  const counts = monthlyVisitCounts({
    months: { jan: 2, January: 1, "07": 9, jul: 1, december: 4 },
  });
  assert.deepEqual(counts, [3, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 4]);
});

test("monthlyVisitCounts returns null when there is no seasonal data to draw", () => {
  assert.equal(monthlyVisitCounts(null), null);
  assert.equal(monthlyVisitCounts({}), null);
  assert.equal(monthlyVisitCounts({ months: { jan: 0, feb: 0 } }), null);
});

test("peakMonthIndexes marks every month tied for busiest, and none when empty", () => {
  assert.deepEqual(peakMonthIndexes([1, 5, 5, 0]), [1, 2]);
  assert.deepEqual(peakMonthIndexes([0, 0, 0]), []);
});

test("amenityRows expands raw enums and omits absent facts", () => {
  const rows = amenityRows({
    toilet: "vault",
    drinking_water: "seasonal",
    reservation: "no",
    fee: { required: false },
    backcountry: true,
  });
  assert.deepEqual(rows, [
    { label: "Toilet", value: "Vault" },
    { label: "Drinking water", value: "Seasonal" },
    { label: "Fee", value: "None" },
    { label: "Reservation", value: "Not needed" },
    { label: "Setting", value: "Backcountry" },
  ]);
  assert.deepEqual(amenityRows(null), []);
});

test("reportPreview takes the first text block and clips it", () => {
  assert.equal(
    reportPreview([{ type: "photo", content: "x" }, { type: "text", content: "  Snowy.  " }]),
    "Snowy."
  );
  assert.equal(reportPreview([{ type: "photo", content: "x" }]), null);
  assert.equal(reportPreview(null), null);
  const long = reportPreview([{ type: "text", content: "a".repeat(300) }]);
  assert.equal(long?.length, 221);
  assert.ok(long?.endsWith("…"));
});
