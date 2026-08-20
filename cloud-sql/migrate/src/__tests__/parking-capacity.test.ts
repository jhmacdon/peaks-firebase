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
  // Documented, not accidental: within trailhead context the paved and unpaved
  // medians sit 42.6 against 37.8 m² a car, a gap far inside the ×1.64 spread
  // the fit already carries. The hint must not start shifting buckets without
  // a recalibration behind it.
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

// Density regimes, not lots. The calibration is ODbL-derived, so no per-lot
// figure from it belongs in this repository — and a round car count paired with
// a published median is not a disguised row either. Each case is "a lot holding
// N cars at M m² each", with N chosen freely.
const regime = (cars: number, m2PerCar: number): [number, number] => [
  cars * m2PerCar,
  cars,
];

test("lots at trailhead-typical densities land within a bucket", () => {
  // 39 m² a car is the trailhead-context median the curve is fitted to, and 57
  // the Forest Service prose median it is measured against. Across that span,
  // and across the size range, nothing may land more than one bucket out.
  const cases: Array<[number, number]> = [
    regime(15, 39),
    regime(45, 39),
    regime(130, 39),
    regime(6, 57),
    regime(28, 57),
    regime(140, 57),
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

test("densities outside the fitted band still miss by two buckets", () => {
  // 8% of the Forest Service prose set misses by two, and pretending otherwise
  // in a test would be the same dishonesty as shipping a point estimate. The
  // curve assumes a trailhead density; lots far outside that band break it in
  // both directions, and no area-based method recovers them.
  //
  // Dense: a tightly striped lot at 20 m² a car holds far more than the curve
  // will ever predict.
  const [dense, denseCars] = regime(150, 20);
  assert.equal(estimateCapacityRange(dense), "25_to_50");
  assert.equal(trueBucket(denseCars), CAPACITY_RANGES.indexOf("100_plus"));

  // Sparse: a gravel staging apron at 220 m² a car is mostly not parking, and
  // the curve reads all of it as parking.
  const [sparse, sparseCars] = regime(40, 220);
  assert.equal(estimateCapacityRange(sparse), "100_plus");
  assert.equal(trueBucket(sparseCars), CAPACITY_RANGES.indexOf("25_to_50"));
});

test("the adjacency bar is mostly bucket geometry, not fit quality", () => {
  // The headline validation number is 92-98% correct-or-adjacent, and it would
  // be high whether or not the calibration were any good: the adjacent band
  // spans a factor of five or more in cars while the residual spread is ×1.64.
  // This simulates a model with the *right* scale and only the observed noise,
  // and a model wrong by a full factor of two — the exact mistake calibrating
  // on the national population would have made. Both clear an 80% adjacency
  // bar. Only exact accuracy separates them, which is why the module header
  // leads with exact accuracy and the scale ladder.
  let seed = 20260820;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const gauss = () =>
    Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

  const run = (bias: number) => {
    const n = 100_000;
    let exact = 0;
    let adjacent = 0;
    for (let i = 0; i < n; i += 1) {
      const truth = Math.exp(Math.log(3) + rand() * (Math.log(300) - Math.log(3)));
      const guess = truth * bias * Math.exp(gauss() * 0.497);
      const t = trueBucket(truth);
      const p = trueBucket(guess);
      if (t === p) exact += 1;
      if (Math.abs(t - p) <= 1) adjacent += 1;
    }
    return { exact: exact / n, adjacent: adjacent / n };
  };

  const honest = run(1);
  const wrongByTwo = run(2);

  // A correctly scaled model is nowhere near 100% exact — the spread forbids it.
  assert.ok(honest.exact > 0.6 && honest.exact < 0.75, `exact ${honest.exact}`);
  assert.ok(honest.adjacent > 0.96, `adjacent ${honest.adjacent}`);

  // And a model wrong by a factor of two still sails past the 80% bar.
  assert.ok(
    wrongByTwo.adjacent > 0.8,
    `a x2 scale error still scores ${wrongByTwo.adjacent} adjacent`
  );
  // Exact accuracy is what notices the error.
  assert.ok(
    honest.exact - wrongByTwo.exact > 0.15,
    `exact should separate the two: ${honest.exact} vs ${wrongByTwo.exact}`
  );
});

test("the ranges and their bounds line up", () => {
  assert.equal(CAPACITY_RANGES.length, CAPACITY_RANGE_BOUNDS.length + 1);
  assert.equal(CAPACITY_RANGES.length, thresholdsM2.length + 1);
  assert.deepEqual(CAPACITY_RANGE_BOUNDS, [10, 25, 50, 100]);
});
