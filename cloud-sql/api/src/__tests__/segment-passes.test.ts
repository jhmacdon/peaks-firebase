import { strict as assert } from "node:assert";
import { test } from "node:test";
import { segmentPasses, type CorridorPoint } from "../segment-passes";

const T0 = 1_800_000_000;
/** One point a minute along the given positions; seq counts every track point. */
function walk(positions: number[], startSeq = 1, startTime = T0): CorridorPoint[] {
  return positions.map((along, i) => [startTime + i * 60, along, startSeq + i]);
}
const row = (points: CorridorPoint[], extra: Partial<Parameters<typeof segmentPasses>[0]> = {}) => ({
  session_id: "s", segment_id: "seg", length_m: 1000, covered_m: 1000, runs: [[0, 1000]] as Array<[number, number]>,
  points, ...extra,
});
const ramp = (from: number, to: number, step = 50) => {
  const out: number[] = [];
  for (let m = from; from <= to ? m <= to : m >= to; m += from <= to ? step : -step) out.push(m);
  return out;
};

test("an out-and-back is two passes in opposite directions, split at the turnaround", () => {
  const passes = segmentPasses(row(walk([...ramp(0, 1000), 1000, 1000, ...ramp(1000, 0)])));
  assert.deepEqual(passes.map((p) => [p.pass_index, p.direction]), [[0, "forward"], [1, "reverse"]]);
  assert.equal(passes[0].exited_at, passes[1].entered_at);
  // The ascent leaves the turnaround at its last point there (two minutes of rest).
  assert.equal(passes[0].exited_at, new Date((T0 + 23 * 60) * 1000).toISOString());
  assert.ok(passes.every((p) => p.covered_m === 1000 && p.covered_fraction === 1));
});

test("a single pass keeps the segment's measured length and the old direction", () => {
  const passes = segmentPasses(row(walk(ramp(1000, 0)), { covered_m: 812.5 }));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].direction, "reverse");
  assert.equal(passes[0].covered_m, 812.5);
});

test("GPS wobble under 100 m never splits a pass", () => {
  const wobble = [0, 100, 200, 140, 210, 300, 230, 400, 600, 800, 1000];
  assert.equal(segmentPasses(row(walk(wobble))).length, 1);
});

test("leaving the corridor for over ten minutes starts a pass; pausing inside it does not", () => {
  const out = [...walk(ramp(0, 400)), ...walk(ramp(450, 1000), 40, T0 + 3600)];
  const left = segmentPasses(row(out, { runs: [[0, 1000]] }));
  assert.equal(left.length, 2);
  assert.ok(left.every((p) => p.direction === "forward"));
  // Same timing, but the recording paused in the corridor: no track point between.
  const paused = [...walk(ramp(0, 400)), ...walk(ramp(450, 1000), 10, T0 + 3600)];
  assert.equal(segmentPasses(row(paused)).length, 1);
});

test("a closed loop walked once is one pass, across the join", () => {
  // Locating a point at the join reads 0 instead of 1000; that is no reversal.
  const loop = [...ramp(0, 950), 0];
  const passes = segmentPasses(row(walk(loop), { closed: true }));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].direction, "forward");
  // Starting part-way round the loop wraps too.
  assert.equal(segmentPasses(row(walk([...ramp(600, 950), ...ramp(0, 550)]), { closed: true })).length, 1);
});

test("passes on a repeated stretch each claim the pieces within their own span", () => {
  const points = [...walk(ramp(0, 600)), ...walk(ramp(600, 400), 14, T0 + 13 * 60)];
  const passes = segmentPasses(row(points, { runs: [[0, 1000]] }));
  assert.equal(passes.length, 2);
  assert.equal(passes[0].covered_m, 630);
  assert.equal(passes[1].covered_m, 260);
});

test("a brush past the segment end below the visit gate is not a pass", () => {
  // Back 20 minutes later for one point near the end: 40 m with the corridor.
  const points = [...walk(ramp(0, 1000)), [T0 + 3600, 990, 60] as CorridorPoint];
  const passes = segmentPasses(row(points));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].pass_index, 0);
});

test("positions wrap at the 2D length, not the elevation-inflated stored length", () => {
  // ST_Length(geography) counts climb; positions and pieces do not.
  const loop = [...ramp(0, 950), 0];
  const passes = segmentPasses(row(walk(loop), { closed: true, length_m: 1300, along_length_m: 1000 }));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].direction, "forward");
});
