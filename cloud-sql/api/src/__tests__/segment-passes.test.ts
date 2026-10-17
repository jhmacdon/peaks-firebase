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
  // It resumes 200 m on, so this is not a stop either.
  const paused = [...walk(ramp(0, 400)), ...walk(ramp(600, 1000), 10, T0 + 3600)];
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

/** Points with projected x/y: along the segment northwards from (0, 0). */
const at = (t: number, along: number, seq: number, east = 0): CorridorPoint => [t, along, seq, east, along];

test("a camp at the segment end ends the pass at arrival; next morning is a new pass", () => {
  const up = ramp(0, 1000).map((m, i) => at(T0 + i * 60, m, i + 1));
  const arrive = up[up.length - 1][0];
  // Ten hours at camp, wandering within 20 m, one point every five minutes.
  const camp = Array.from({ length: 120 }, (_, k) => at(arrive + (k + 1) * 300, 1000 - (k % 3) * 8, 22 + k, (k % 4) * 5));
  const leave = camp[camp.length - 1][0];
  const down = ramp(950, 0).map((m, i) => at(leave + (i + 1) * 60, m, 142 + i));
  const passes = segmentPasses(row([...up, ...camp, ...down]));
  assert.deepEqual(passes.map((p) => [p.pass_index, p.direction]), [[0, "forward"], [1, "reverse"]]);
  assert.equal(passes[0].exited_at, new Date(arrive * 1000).toISOString());
  assert.equal(passes[1].entered_at, new Date(leave * 1000).toISOString());
  assert.equal(passes[1].exited_at, new Date((leave + 20 * 60) * 1000).toISOString());
});

test("a camp beside a short piece leaves only the walked passes, not a 10-hour one", () => {
  // A 34 m piece ending at camp: walked in, slept beside, then left another way.
  const walkIn = [at(T0, 0, 1), at(T0 + 30, 17, 2), at(T0 + 60, 34, 3)];
  const camp = Array.from({ length: 100 }, (_, k) => at(T0 + 60 + (k + 1) * 360, 34, 4 + k, 10));
  const passes = segmentPasses(row([...walkIn, ...camp], { length_m: 34, covered_m: 34, runs: [[0, 34]] }));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].entered_at, new Date(T0 * 1000).toISOString());
  assert.equal(passes[0].exited_at, new Date((T0 + 60) * 1000).toISOString());
});

test("a 15-minute rest does not split a pass", () => {
  const before = ramp(0, 500).map((m, i) => at(T0 + i * 60, m, i + 1));
  const restStart = before[before.length - 1][0];
  const rest = Array.from({ length: 15 }, (_, k) => at(restStart + (k + 1) * 60, 500, 12 + k, 3));
  const after = ramp(550, 1000).map((m, i) => at(restStart + 15 * 60 + (i + 1) * 60, m, 27 + i));
  const passes = segmentPasses(row([...before, ...rest, ...after]));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].direction, "forward");
});
