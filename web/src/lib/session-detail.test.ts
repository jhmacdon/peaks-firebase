import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  ascentDescentFits,
  buildSessionAchievements,
  buildSessionSecondaryStats,
  buildSessionSplits,
  buildSessionTopline,
  elapsedSeconds,
  formatClock,
  formatDurationValue,
  formatPaceValue,
  smoothMetricSeries,
  smoothingRadius,
  type SessionStatSource,
} from "./session-detail";

function session(overrides: Partial<SessionStatSource> = {}): SessionStatSource {
  return {
    distance: 15427.4,
    gain: 1088.2,
    total_time: 14886,
    highest_point: 3845.9,
    pace: 1.036,
    ascent_time: 8142,
    descent_time: 6616,
    start_time: "2022-08-27T13:22:16.346Z",
    end_time: "2022-08-27T17:55:00.000Z",
    ...overrides,
  };
}

test("formatDurationValue prints hours only when there are any", () => {
  assert.equal(formatDurationValue(14886), "4h 8m");
  assert.equal(formatDurationValue(2880), "48m");
  assert.equal(formatDurationValue(0), "0m");
});

test("formatDurationValue drops absent and negative durations", () => {
  assert.equal(formatDurationValue(null), null);
  assert.equal(formatDurationValue(undefined), null);
  assert.equal(formatDurationValue(Number.NaN), null);
  assert.equal(formatDurationValue(-60), null);
});

test("formatPaceValue converts metres per second to minutes per mile", () => {
  assert.equal(formatPaceValue(1.036), "25:53");
  assert.equal(formatPaceValue(1609.34 / 600), "10:00");
});

test("formatPaceValue refuses a paused-recording speed", () => {
  assert.equal(formatPaceValue(0), null);
  assert.equal(formatPaceValue(0.04), null);
  assert.equal(formatPaceValue(null), null);
});

test("formatClock adds the hour field only past an hour", () => {
  assert.equal(formatClock(262), "4:22");
  assert.equal(formatClock(3862), "1:04:22");
  assert.equal(formatClock(-5), "0:00");
});

test("elapsedSeconds measures the wall clock, not the recording", () => {
  assert.equal(
    elapsedSeconds("2022-08-27T13:22:16.346Z", "2022-08-27T17:55:00.000Z"),
    16363.654
  );
  assert.equal(elapsedSeconds("2022-08-27T13:22:16.346Z", null), null);
  assert.equal(
    elapsedSeconds("2022-08-27T17:55:00.000Z", "2022-08-27T13:22:16.346Z"),
    null
  );
});

test("buildSessionTopline prints the four headline numerals with units", () => {
  assert.deepEqual(buildSessionTopline(session()), [
    { key: "distance", value: "9.6", unit: "mi", label: "Distance" },
    { key: "gain", value: "3,570", unit: "ft", label: "Elevation gain" },
    { key: "time", value: "4h 8m", label: "Time" },
    { key: "high", value: "12,618", unit: "ft", label: "High point" },
  ]);
});

test("buildSessionTopline omits a stat rather than dashing it", () => {
  const stats = buildSessionTopline(
    session({ gain: null, highest_point: null })
  );
  assert.deepEqual(
    stats.map((stat) => stat.key),
    ["distance", "time"]
  );
});

test("ascentDescentFits rejects a recorder's impossible split", () => {
  // Production row FQXfSLnUIue1w8O2YrA9: 35h climbing inside a 28h activity.
  assert.equal(
    ascentDescentFits(
      session({ total_time: 102182, ascent_time: 127692, descent_time: 49247 })
    ),
    false
  );
  assert.equal(ascentDescentFits(session()), true);
  assert.equal(ascentDescentFits(session({ ascent_time: null })), false);
  assert.equal(ascentDescentFits(session({ total_time: 0 })), false);
});

test("buildSessionSecondaryStats carries pace, elapsed and the climb split", () => {
  const stats = buildSessionSecondaryStats(session(), null);
  assert.deepEqual(
    stats.map((stat) => stat.key),
    ["pace", "elapsed", "ascent", "descent"]
  );
  assert.deepEqual(stats[0], {
    key: "pace",
    value: "25:53",
    unit: "/mi",
    label: "Pace",
  });
  assert.equal(stats[1].value, "4h 33m");
});

test("buildSessionSecondaryStats drops elapsed when it matches the recording", () => {
  const stats = buildSessionSecondaryStats(
    session({
      start_time: "2022-08-27T13:22:16.000Z",
      end_time: "2022-08-27T17:30:22.000Z",
      total_time: 14886,
    }),
    null
  );
  assert.equal(
    stats.some((stat) => stat.key === "elapsed"),
    false
  );
});

test("buildSessionSecondaryStats appends only the health samples present", () => {
  const stats = buildSessionSecondaryStats(
    session({ pace: null, end_time: null, ascent_time: null }),
    { averageHeartRate: 132, maximumHeartRate: null, activeCalories: 1840 }
  );
  assert.deepEqual(stats, [
    { key: "avg-hr", value: "132", unit: "bpm", label: "Avg heart rate" },
    { key: "energy", value: "1,840", unit: "cal", label: "Active energy" },
  ]);
});

test("buildSessionSecondaryStats returns nothing for a bare recording", () => {
  assert.deepEqual(
    buildSessionSecondaryStats(
      session({ pace: null, end_time: null, ascent_time: null, descent_time: null }),
      { averageHeartRate: null, maximumHeartRate: null, activeCalories: null }
    ),
    []
  );
});

const MILE = 1609.34;

test("buildSessionSplits interpolates each mile boundary between points", () => {
  // Four points 0.5 mi apart, 10 minutes each: a steady 20 min/mi.
  const points = [
    { time: 0, elevation: 100 },
    { time: 600, elevation: 200 },
    { time: 1200, elevation: 300 },
    { time: 1800, elevation: 400 },
  ];
  const distances = [0, MILE * 0.5, MILE, MILE * 1.5];

  const splits = buildSessionSplits(points, distances);
  assert.equal(splits.length, 2);
  assert.deepEqual(splits[0], {
    mile: 1,
    fraction: 1,
    seconds: 1200,
    secondsPerMile: 1200,
    changeMeters: 200,
  });
  assert.equal(splits[1].mile, 2);
  assert.ok(Math.abs(splits[1].fraction - 0.5) < 1e-9);
  assert.equal(splits[1].seconds, 600);
  assert.ok(Math.abs(splits[1].secondsPerMile - 1200) < 1e-6);
});

test("buildSessionSplits interpolates a boundary inside one long leg", () => {
  const points = [
    { time: 0, elevation: 0 },
    { time: 1000, elevation: 500 },
  ];
  const distances = [0, MILE * 2];

  const splits = buildSessionSplits(points, distances);
  assert.equal(splits.length, 2);
  assert.equal(splits[0].seconds, 500);
  assert.equal(splits[0].changeMeters, 250);
  assert.equal(splits[1].seconds, 500);
});

test("buildSessionSplits drops a trailing sliver of a mile", () => {
  const points = [
    { time: 0, elevation: null },
    { time: 600, elevation: null },
    { time: 610, elevation: null },
  ];
  const distances = [0, MILE, MILE * 1.01];

  const splits = buildSessionSplits(points, distances);
  assert.equal(splits.length, 1);
  assert.equal(splits[0].changeMeters, null);
});

test("buildSessionSplits refuses a track too short to split", () => {
  assert.deepEqual(buildSessionSplits([{ time: 0, elevation: null }], [0]), []);
  assert.deepEqual(
    buildSessionSplits(
      [
        { time: 0, elevation: null },
        { time: 10, elevation: null },
      ],
      [0, 50]
    ),
    []
  );
});

test("smoothingRadius scales with the recording and stops at a cap", () => {
  assert.equal(smoothingRadius(8), 0);
  assert.equal(smoothingRadius(120), 2);
  assert.equal(smoothingRadius(600), 5);
  assert.equal(smoothingRadius(5000), 12);
});

test("smoothMetricSeries flattens a spike without moving the baseline", () => {
  const values = Array.from({ length: 200 }, () => 2);
  values[100] = 40;
  const smoothed = smoothMetricSeries(values) as number[];

  assert.equal(smoothingRadius(values.length), 2);
  assert.equal(smoothed[0], 2);
  assert.equal(smoothed[100], (2 * 4 + 40) / 5);
  assert.ok(smoothed[100] < 12, "the spike is cut down, not preserved");
  assert.equal(smoothed[199], 2);
});

test("smoothMetricSeries never averages across a gap", () => {
  const values: (number | null)[] = Array.from({ length: 200 }, () => 3);
  values[50] = null;
  const smoothed = smoothMetricSeries(values);

  assert.equal(smoothed[50], null);
  assert.equal(smoothed[51], 3);
});

test("smoothMetricSeries leaves a series too short to smooth alone", () => {
  const values = [1, 9, 1];
  assert.deepEqual(smoothMetricSeries(values), values);
});

const CAMP_MUIR = { lat: 46.8362, lng: -121.7311 };
const PARADISE = { lat: 46.7858, lng: -121.7359 };

test("buildSessionAchievements dates each summit from the nearest track point", () => {
  const achievements = buildSessionAchievements(
    [
      {
        id: "muir",
        name: "Camp Muir",
        elevation: 3072,
        ...CAMP_MUIR,
        relation: "reached",
      },
      {
        id: "paradise",
        name: "Paradise",
        elevation: 1646,
        ...PARADISE,
        relation: "reached",
      },
    ],
    [
      { ...PARADISE, time: 1_000 },
      { ...CAMP_MUIR, time: 20_000 },
    ]
  );

  assert.deepEqual(achievements, [
    { id: "paradise", name: "Paradise", elevation: 1646, reachedAt: 1_000 },
    { id: "muir", name: "Camp Muir", elevation: 3072, reachedAt: 20_000 },
  ]);
});

test("buildSessionAchievements withholds a time when the track stayed away", () => {
  const achievements = buildSessionAchievements(
    [
      {
        id: "muir",
        name: "Camp Muir",
        elevation: 3072,
        ...CAMP_MUIR,
        relation: "reached",
      },
    ],
    [{ ...PARADISE, time: 1_000 }]
  );

  assert.equal(achievements.length, 1);
  assert.equal(achievements[0].reachedAt, null);
});

test("buildSessionAchievements ignores goals and unnamed destinations", () => {
  const achievements = buildSessionAchievements(
    [
      { id: "goal", name: "Mount Rainier", elevation: 4392, ...CAMP_MUIR, relation: "goal" },
      { id: "blank", name: null, elevation: null, ...CAMP_MUIR, relation: "reached" },
    ],
    [{ ...CAMP_MUIR, time: 5 }]
  );

  assert.deepEqual(achievements, []);
});

test("buildSessionAchievements falls back to highest-first without a track", () => {
  const achievements = buildSessionAchievements(
    [
      { id: "low", name: "Pinnacle Peak", elevation: 1900, ...PARADISE, relation: "reached" },
      { id: "high", name: "Camp Muir", elevation: 3072, ...CAMP_MUIR, relation: "reached" },
    ],
    []
  );

  assert.deepEqual(
    achievements.map((achievement) => achievement.id),
    ["high", "low"]
  );
});
