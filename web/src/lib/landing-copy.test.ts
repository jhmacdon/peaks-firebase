import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_LANDING_TYPES,
  INDEXABLE_ACTIVITY_LANDING_TYPES,
  activityLandingConfig,
  buildStateEditorialParagraph,
  buildStateLandingFaqs,
  isActivityLandingType,
} from "./landing-copy";

test("isActivityLandingType accepts exactly the four validated types", () => {
  for (const type of ACTIVITY_LANDING_TYPES) {
    assert.ok(isActivityLandingType(type));
  }
  assert.equal(isActivityLandingType("running"), false);
  assert.equal(isActivityLandingType("Hiking"), false);
  assert.equal(isActivityLandingType(""), false);
});

test("hiking and peak-bagging carry live content; skiing and trail-running don't", () => {
  assert.equal(activityLandingConfig("hiking").hasLiveContent, true);
  assert.equal(activityLandingConfig("peak-bagging").hasLiveContent, true);
  assert.equal(activityLandingConfig("skiing").hasLiveContent, false);
  assert.equal(activityLandingConfig("trail-running").hasLiveContent, false);
});

test("only activity pages with live catalog data are indexable", () => {
  assert.deepEqual(INDEXABLE_ACTIVITY_LANDING_TYPES, ["hiking", "peak-bagging"]);
});

test("every activity paragraph renders without a live count (settled-null case)", () => {
  for (const type of ACTIVITY_LANDING_TYPES) {
    const paragraph = activityLandingConfig(type).paragraph({ count: null });
    assert.ok(paragraph.length > 0);
    assert.ok(!paragraph.includes("null"));
    assert.ok(!paragraph.includes("undefined"));
  }
});

test("hiking's paragraph cites the live count when present", () => {
  const paragraph = activityLandingConfig("hiking").paragraph({ count: 1284 });
  assert.match(paragraph, /1,200\+ hikes/);
});

test("activity FAQs use an exact live count and omit it when unavailable", () => {
  const live = activityLandingConfig("hiking").faqs({ count: 1284 });
  const degraded = activityLandingConfig("hiking").faqs({ count: null });

  assert.match(live.map((item) => item.answer).join(" "), /1,284 recorded hikes/);
  assert.equal(degraded.some((item) => item.question.includes("How many")), false);
});

test("peak-bagging's paragraph cites the live count when present", () => {
  const paragraph = activityLandingConfig("peak-bagging").paragraph({ count: 41547 });
  assert.match(paragraph, /41,000\+ named summits/);
});

test("skiing and trail-running paragraphs are static — no count to invent", () => {
  const skiing = activityLandingConfig("skiing").paragraph({ count: null });
  const running = activityLandingConfig("trail-running").paragraph({ count: null });
  assert.match(skiing, /doesn't track ski touring/);
  assert.match(running, /same way it logs a hike/);
});

test("buildStateEditorialParagraph includes every fact that's present", () => {
  const paragraph = buildStateEditorialParagraph({
    stateName: "Washington",
    destinationCount: 5361,
    summitCount: 2194,
    highestPeak: { name: "Mount Rainier", elevationFeet: 14411 },
    leadingArea: { name: "Mount Rainier National Park", destinationCount: 42 },
  });
  assert.match(paragraph, /5,361 destinations in Washington/);
  assert.match(paragraph, /2,194 named summits/);
  assert.match(paragraph, /Mount Rainier at 14,411 ft/);
  assert.match(paragraph, /42 of the state's destinations are in Mount Rainier National Park/);
});

test("buildStateEditorialParagraph omits an unresolved highest peak — no dash, no placeholder", () => {
  const paragraph = buildStateEditorialParagraph({
    stateName: "Rhode Island",
    destinationCount: 12,
    summitCount: 2,
    highestPeak: null,
    leadingArea: null,
  });
  assert.equal(
    paragraph,
    "Peaks tracks 12 destinations in Rhode Island, including 2 named summits."
  );
  assert.ok(!paragraph.includes("null"));
  assert.ok(!paragraph.includes("—"));
});

test("buildStateEditorialParagraph handles the singular destination case", () => {
  const paragraph = buildStateEditorialParagraph({
    stateName: "Delaware",
    destinationCount: 1,
    summitCount: 0,
    highestPeak: null,
    leadingArea: null,
  });
  assert.match(paragraph, /1 destination in Delaware\./);
});

test("state FAQs separate summit counts from the wider destination catalog", () => {
  const faqs = buildStateLandingFaqs({
    stateName: "Washington",
    destinationCount: 5361,
    summitCount: 2194,
    highestPeak: { name: "Mount Rainier", elevationFeet: 14411 },
    leadingArea: { name: "Mount Rainier National Park", destinationCount: 42 },
  });
  const answers = faqs.map((item) => item.answer).join(" ");

  assert.match(answers, /2,194 destinations tagged as summits/);
  assert.match(answers, /full state catalog has 5,361 mountain destinations/);
  assert.match(answers, /Mount Rainier.*14,411 ft/);
  assert.match(answers, /42 linked destinations/);
});
