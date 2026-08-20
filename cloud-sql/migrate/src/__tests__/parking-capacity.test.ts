import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CAPACITY_RANGES,
  CAPACITY_RANGE_BOUNDS,
  PARKING_CAPACITY_CALIBRATION,
  estimateCapacityRange,
  fittedCapacityCurve,
  type TrailheadParkingCapacityRange,
} from "../parking-capacity";

const { thresholdsM2, minLotAreaM2, maxLotAreaM2, coefficient, exponent } =
  PARKING_CAPACITY_CALIBRATION;

test("the published thresholds are the published curve at the bucket edges", () => {
  // The two halves of the calibration can drift apart in a careless edit: a
  // nudged threshold with the old curve still beside it looks fitted and is
  // not. Each threshold has to be the area at which the curve reaches its
  // bucket's lower bound, to within the rounding to whole m².
  CAPACITY_RANGE_BOUNDS.forEach((cars, i) => {
    const area = Math.exp((Math.log(cars) - Math.log(coefficient)) / exponent);
    assert.ok(
      Math.abs(area - thresholdsM2[i]) < 1,
      `threshold ${i} is ${thresholdsM2[i]} m² but the curve reaches ${cars} cars at ${area.toFixed(1)} m²`
    );
    assert.ok(Math.abs(fittedCapacityCurve(thresholdsM2[i]) - cars) < 0.01);
  });
});

test("the minimum area is where the curve reaches three cars", () => {
  // A three-car apron is a pullout, not a lot, and the gate has to keep
  // meaning that if the curve is ever refitted.
  const threeCars = Math.exp((Math.log(3) - Math.log(coefficient)) / exponent);
  assert.ok(Math.abs(threeCars - minLotAreaM2) < 1);
});

test("thresholds are strictly increasing and sit inside the gates", () => {
  for (let i = 1; i < thresholdsM2.length; i += 1) {
    assert.ok(thresholdsM2[i] > thresholdsM2[i - 1]);
  }
  assert.ok(thresholdsM2[0] > minLotAreaM2);
  assert.ok(thresholdsM2[thresholdsM2.length - 1] < maxLotAreaM2);
});

test("each bucket is entered exactly at its threshold", () => {
  const expected: TrailheadParkingCapacityRange[] = [
    "10_to_25",
    "25_to_50",
    "50_to_100",
    "100_plus",
  ];
  thresholdsM2.forEach((t, i) => {
    assert.equal(estimateCapacityRange(t - 0.5), CAPACITY_RANGES[i]);
    assert.equal(estimateCapacityRange(t), expected[i]);
  });
});

test("a lot in the middle of each band lands in that band", () => {
  assert.equal(estimateCapacityRange(150), "under_10");
  assert.equal(estimateCapacityRange(800), "10_to_25");
  assert.equal(estimateCapacityRange(2_400), "25_to_50");
  assert.equal(estimateCapacityRange(6_000), "50_to_100");
  assert.equal(estimateCapacityRange(20_000), "100_plus");
});

test("no claim below the three-car floor", () => {
  assert.equal(estimateCapacityRange(minLotAreaM2 - 0.5), null);
  assert.equal(estimateCapacityRange(40), null);
  assert.equal(estimateCapacityRange(1), null);
  // and the floor itself is a claim
  assert.equal(estimateCapacityRange(minLotAreaM2), "under_10");
});

test("no claim above the sanity cap", () => {
  assert.equal(estimateCapacityRange(maxLotAreaM2 + 1), null);
  // the 250,506 m² NPS ring that is plainly not one lot
  assert.equal(estimateCapacityRange(250_506), null);
  assert.equal(estimateCapacityRange(maxLotAreaM2), "100_plus");
});

test("no claim for an area that is not a positive number", () => {
  for (const bad of [0, -1, -1_000, Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY]) {
    assert.equal(estimateCapacityRange(bad), null, `${bad} should make no claim`);
  }
});

test("the answer never shrinks as the lot grows", () => {
  let last = -1;
  for (let area = minLotAreaM2; area <= maxLotAreaM2; area += 37) {
    const range = estimateCapacityRange(area);
    assert.notEqual(range, null);
    const idx = CAPACITY_RANGES.indexOf(range as TrailheadParkingCapacityRange);
    assert.ok(idx >= last, `range fell back at ${area} m²`);
    last = idx;
  }
});

test("the surface hint is accepted and does not move the answer", () => {
  // Documented, not accidental: within trailhead context the paved/unpaved
  // difference did not survive scoring, so the hint must not silently start
  // shifting buckets without a recalibration behind it.
  for (const area of [90, 200, 383, 900, 1_330, 2_500, 3_414, 6_000, 8_762, 30_000]) {
    const flat = estimateCapacityRange(area);
    assert.equal(estimateCapacityRange(area, "paved"), flat, `paved moved ${area}`);
    assert.equal(estimateCapacityRange(area, "unpaved"), flat, `unpaved moved ${area}`);
  }
});

const trueBucket = (cars: number) => {
  const i = CAPACITY_RANGE_BOUNDS.findIndex((b) => cars < b);
  return i === -1 ? CAPACITY_RANGES.length - 1 : i;
};

// The density regimes the validation found, as ratios rather than as lots: the
// calibration is ODbL-derived and no per-lot figure from it belongs in this
// repository. Each row is "a lot holding N cars at M m² each".
const regime = (cars: number, m2PerCar: number): [number, number] => [
  cars * m2PerCar,
  cars,
];

test("lots at trailhead-typical densities land within a bucket", () => {
  // 39 m² a car is the trailhead-context median and 57 the Forest Service
  // prose median; both ends of that span have to stay inside one bucket of the
  // truth, because adjacency is the contract the validation measured.
  const cases: Array<[number, number]> = [
    regime(12, 39),
    regime(35, 39),
    regime(120, 39),
    regime(8, 57),
    regime(30, 57),
    regime(150, 57),
  ];
  for (const [area, cars] of cases) {
    const got = estimateCapacityRange(area);
    assert.notEqual(got, null, `${area} m²`);
    const gotIdx = CAPACITY_RANGES.indexOf(got as TrailheadParkingCapacityRange);
    assert.ok(
      Math.abs(gotIdx - trueBucket(cars)) <= 1,
      `${area} m² holding ${cars} cars predicted ${got}`
    );
  }
});

test("the densities the calibration refuses to assume still miss by two", () => {
  // 8% of the Forest Service prose set misses by two buckets, and pretending
  // otherwise in a test would be the same dishonesty as shipping a point
  // estimate. Both ends are real and neither is recoverable from area: a
  // striped lot at 24 m² a car packs in more than a trailhead curve will ever
  // predict, and a gravel staging apron at 200 m² a car is mostly not parking.
  // Pinned so a refit that changes either shows up as a changed test rather
  // than as silence.
  const [dense, denseCars] = regime(120, 24);
  assert.equal(estimateCapacityRange(dense), "25_to_50");
  assert.equal(trueBucket(denseCars), CAPACITY_RANGES.indexOf("100_plus"));

  const [sparse, sparseCars] = regime(40, 200);
  assert.equal(estimateCapacityRange(sparse), "50_to_100");
  assert.equal(trueBucket(sparseCars), CAPACITY_RANGES.indexOf("25_to_50"));
});

test("the ranges and their bounds line up", () => {
  assert.equal(CAPACITY_RANGES.length, CAPACITY_RANGE_BOUNDS.length + 1);
  assert.equal(CAPACITY_RANGES.length, thresholdsM2.length + 1);
  assert.deepEqual(CAPACITY_RANGE_BOUNDS, [10, 25, 50, 100]);
});
