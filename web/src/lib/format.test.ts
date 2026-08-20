import assert from "node:assert/strict";
import test from "node:test";

import {
  describeElevationProfile,
  formatCoordinates,
  formatDate,
  formatDurationRangeFriendly,
  formatFlooredCount,
  formatHoursFriendly,
  formatSessionCount,
  roundToQuarterHour,
} from "./format";

test("roundToQuarterHour snaps to the nearest quarter hour", () => {
  assert.equal(roundToQuarterHour(3.1), 3);
  assert.equal(roundToQuarterHour(3.13), 3.25);
  assert.equal(roundToQuarterHour(3.4), 3.5);
  assert.equal(roundToQuarterHour(3.65), 3.75);
  assert.equal(roundToQuarterHour(2), 2);
});

test("formatHoursFriendly drops a trailing .0 but keeps real fractions", () => {
  assert.equal(formatHoursFriendly(5), "5");
  assert.equal(formatHoursFriendly(3.5), "3.5");
  assert.equal(formatHoursFriendly(3.26), "3.25");
});

test("formatDurationRangeFriendly renders a rounded, en-dashed range", () => {
  assert.equal(formatDurationRangeFriendly(3.4, 5), "3.5–5 hr");
  assert.equal(formatDurationRangeFriendly(0.5, 1), "0.5–1 hr");
});

test("formatDurationRangeFriendly falls back to an em dash when a bound is missing", () => {
  assert.equal(formatDurationRangeFriendly(null, 5), "—");
  assert.equal(formatDurationRangeFriendly(3, undefined), "—");
  assert.equal(formatDurationRangeFriendly(NaN, 5), "—");
});

test("formatCoordinates renders hemisphere letters instead of signed decimals", () => {
  assert.equal(formatCoordinates(47.488, -121.722), "47.4880° N, 121.7220° W");
  assert.equal(formatCoordinates(-33.8688, 151.2093), "33.8688° S, 151.2093° E");
});

test("formatCoordinates returns null when either coordinate is missing", () => {
  assert.equal(formatCoordinates(null, -121.722), null);
  assert.equal(formatCoordinates(47.488, undefined), null);
});

test("formatSessionCount is the single session-count phrase", () => {
  assert.equal(formatSessionCount(0), "0 sessions");
  assert.equal(formatSessionCount(1), "1 session");
  assert.equal(formatSessionCount(42), "42 sessions");
});

test("formatDate renders the one short calendar-date phrase", () => {
  // Built from local-time components (not a UTC ISO string) so the
  // assertion doesn't depend on the test runner's time zone.
  assert.equal(formatDate(new Date(2022, 7, 27)), "Aug 27, 2022");
  assert.equal(formatDate(new Date(2026, 0, 5)), "Jan 5, 2026");
});

test("formatFlooredCount never claims more than the catalog holds", () => {
  assert.equal(formatFlooredCount(70334), "70,000+");
  assert.equal(formatFlooredCount(70000), "70,000+");
  assert.equal(formatFlooredCount(69999), "69,000+");
  assert.equal(formatFlooredCount(3869, 1000), "3,000+");
  assert.equal(formatFlooredCount(257, 100), "200+");
});

test("formatFlooredCount drops the plus below one step", () => {
  assert.equal(formatFlooredCount(940), "940");
  assert.equal(formatFlooredCount(0), "0");
  assert.equal(formatFlooredCount(-5), "0");
  assert.equal(formatFlooredCount(Number.NaN), "0");
});

test("describeElevationProfile speaks the whole chart when every field is known", () => {
  assert.equal(
    describeElevationProfile({
      distanceMeters: 15427.4,
      gainMeters: 1088.2,
      highPointMeters: 3845.9,
    }),
    "Elevation profile: 9.6 miles, 3,570 feet of gain, high point 12,618 feet"
  );
});

test("describeElevationProfile omits a measurement rather than dashing it", () => {
  assert.equal(
    describeElevationProfile({ distanceMeters: 8046.7, gainMeters: null }),
    "Elevation profile: 5.0 miles"
  );
  assert.equal(
    describeElevationProfile({ highPointMeters: 3105 }),
    "Elevation profile: high point 10,187 feet"
  );
});

test("describeElevationProfile falls back to a bare label", () => {
  assert.equal(describeElevationProfile({}), "Elevation profile");
  assert.equal(
    describeElevationProfile({
      distanceMeters: null,
      gainMeters: undefined,
      highPointMeters: Number.NaN,
    }),
    "Elevation profile"
  );
});
