import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "./fixtures/rainier-route-glacier-crossings.json";
import { buildGlacierStretches, GLACIER_STRETCH_THRESHOLDS,
  type GlacierCrossing, type GlacierStretch } from "../lib/glacier-stretches";

function crossing(id: string, start: number, end: number, fields: Partial<GlacierCrossing> = {}): GlacierCrossing {
  return { destination_id: id, name: id, kind: "glacier", entered_distance_m: start,
    exited_distance_m: end, min_elevation_m: null, max_elevation_m: null, ...fields };
}

function sequence(ids: string[], lengths: number[]): GlacierCrossing[] {
  let distance = 0;
  return ids.map((id, i) => {
    const start = distance;
    distance += lengths[i];
    return crossing(id, start, distance);
  });
}

function routeCrossings(name: string): GlacierCrossing[] {
  return fixture.filter(c => c.route === name).map(c => ({ ...c,
    kind: c.name === "Muir Snowfield" ? "snowfield" : "glacier",
    entered_at: null, exited_at: null, segment_number: 0 }));
}

function rows(stretches: GlacierStretch[]): string[] {
  return stretches.map(stretch => stretch.destinations.map(d => d.name).join(" / "));
}

test("Disappointment Cleaver preserves the rock gap and settled Emmons run, then shows one border and one crater row", () => {
  const input = routeCrossings("Disappointment Cleaver Route");
  const original = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const stretches = buildGlacierStretches(input);
  assert.deepEqual(rows(stretches), ["Muir Snowfield", "Cowlitz Glacier", "Ingraham Glacier",
    "Ingraham Glacier", "Emmons Glacier", "Ingraham Glacier / Emmons Glacier", "Columbia Crest Glacier"]);
  assert.deepEqual(stretches.map(s => [s.entered_distance_m, s.exited_distance_m]), [
    [4029.7, 6649.2], [6692.6, 7506.3], [7828.4, 8801.6], [9549.5, 9800.7],
    [9800.7, 10378.1], [10378.1, 11238.7], [11256, 11815.9],
  ]);
  assert.ok(stretches[3].entered_distance_m - stretches[2].exited_distance_m > 747);
  const border = stretches[5];
  assert.equal(border.kind, "border");
  assert.deepEqual(border.crossing_indexes, [5, 6, 7, 8, 9, 10, 11]);
  assert.ok(border.destinations[0].share > 0.72 && border.destinations[0].share < 0.74);
  assert.equal(border.min_elevation_m, 4064);
  assert.equal(border.max_elevation_m, 4316);
  const crater = stretches[6];
  assert.equal(crater.kind, "glacier");
  assert.deepEqual(crater.crossing_indexes, [12, 13]);
  assert.equal(crater.min_elevation_m, 4314);
  assert.equal(crater.max_elevation_m, 4392);
  assert.equal(stretches[0].destinations[0].kind, "snowfield");
  assert.deepEqual(stretches.flatMap(s => s.crossing_indexes), input.map((_, i) => i));
  assert.deepEqual(input, original, "the exact crossings stay unchanged");
});

test("Emmons Glacier Route merges Inter Glacier's short rock gap and absorbs its 12 m Emmons sliver", () => {
  const stretches = buildGlacierStretches(routeCrossings("Emmons Glacier Route"));
  assert.deepEqual(rows(stretches), ["Inter Glacier", "Emmons Glacier", "Winthrop Glacier", "Columbia Crest Glacier"]);
  assert.deepEqual(stretches.map(s => [s.entered_distance_m, s.exited_distance_m]), [
    [7176.3, 8284.6], [8619.4, 9191.8], [9267.5, 12336.6], [12563.5, 12605.6],
  ]);
  assert.deepEqual(stretches[0].crossing_indexes, [0, 1]);
  assert.deepEqual(stretches[2].crossing_indexes, [3, 4, 5]);
  assert.ok(stretches.every(s => s.kind === "glacier"));
});

test("a clean A to B transition stays two rows", () => {
  assert.deepEqual(rows(buildGlacierStretches(sequence(["A", "B"], [900, 800]))), ["A", "B"]);
});

test("jitter between settled A and B runs splits at the last switch into B", () => {
  const input = sequence(["A", "B", "A", "B", "A", "B"], [800, 80, 70, 80, 70, 800]);
  const stretches = buildGlacierStretches(input);
  assert.deepEqual(rows(stretches), ["A", "B"]);
  assert.deepEqual(stretches.map(s => [s.entered_distance_m, s.exited_distance_m]), [[0, 1100], [1100, 1900]]);
  assert.deepEqual(stretches.map(s => s.crossing_indexes), [[0, 1, 2, 3, 4], [5]]);
});

test("a transition must be short relative to both flanks and must stay under the absolute cap", () => {
  for (const [flank, jitter] of [[400, 80], [2000, 180]]) {
    const stretches = buildGlacierStretches(sequence(["A", "B", "A", "B", "A", "B"],
      [flank, jitter, jitter, jitter, jitter, flank]));
    assert.deepEqual(rows(stretches), ["A", "A / B", "B"]);
  }
});

test("sustained alternation with no settled winner becomes one combined span", () => {
  const stretches = buildGlacierStretches(sequence(["B", "A", "B", "A", "B"], [100, 150, 100, 150, 100]));
  assert.deepEqual(rows(stretches), ["A / B"]);
  assert.equal(stretches[0].kind, "border");
  assert.equal(stretches[0].entered_distance_m, 0);
  assert.equal(stretches[0].exited_distance_m, 600);
  assert.deepEqual(stretches[0].destinations.map(d => d.share), [0.5, 0.5]);
  assert.deepEqual(stretches[0].crossing_indexes, [0, 1, 2, 3, 4]);
});

test("a border requires meaningful distance, repeated switches and minority support", () => {
  for (const [ids, lengths] of [
    [["A", "B", "A", "B"], [50, 50, 50, 50]],
    [["A", "B"], [200, 200]],
    [["A", "B", "C", "D"], [100, 100, 100, 100]],
    [["A", "B", "A", "B", "A", "B"], [240, 45, 240, 45, 240, 45]],
  ] as [string[], number[]][]) {
    assert.ok(buildGlacierStretches(sequence(ids, lengths)).every(s => s.kind === "glacier"));
  }
});

test("new glaciers at the edges of sustained alternation keep separate visits below the settled threshold", () => {
  const stretches = buildGlacierStretches(sequence(["C", "A", "B", "A", "B", "D"], [395, 100, 100, 100, 100, 395]));
  assert.deepEqual(rows(stretches), ["C", "A / B", "D"]);
  assert.deepEqual(stretches.map(s => s.crossing_indexes), [[0], [1, 2, 3, 4], [5]]);
});

test("an isolated sliver is absorbed with its elevation range and source index", () => {
  const input = sequence(["A", "B", "A"], [300, 30, 300]);
  input[0].min_elevation_m = 100;
  input[0].max_elevation_m = 200;
  input[1].min_elevation_m = 90;
  input[1].max_elevation_m = 210;
  const stretches = buildGlacierStretches(input);
  assert.deepEqual(rows(stretches), ["A"]);
  assert.equal(stretches[0].exited_distance_m, 630);
  assert.deepEqual(stretches[0].destinations.map(d => d.share), [1]);
  assert.deepEqual(stretches[0].crossing_indexes, [0, 1, 2]);
  assert.equal(stretches[0].min_elevation_m, 90);
  assert.equal(stretches[0].max_elevation_m, 210);
});

test("short visits without a return and visits beyond the sliver limit remain visible", () => {
  assert.deepEqual(rows(buildGlacierStretches(sequence(["A", "B"], [800, 25]))), ["A", "B"]);
  assert.deepEqual(rows(buildGlacierStretches(sequence(["A", "B", "A"], [800, 60, 800]))), ["A", "B", "A"]);
});

test("same-glacier gaps through 200 m merge but a long off-ice visit stays separate", () => {
  const input = [crossing("A", 0, 100), crossing("A", 300, 400), crossing("A", 1147, 1300)];
  const stretches = buildGlacierStretches(input);
  assert.deepEqual(rows(stretches), ["A", "A"]);
  assert.deepEqual(stretches.map(s => [s.entered_distance_m, s.exited_distance_m]), [[0, 400], [1147, 1300]]);
  assert.deepEqual(stretches.map(s => s.crossing_indexes), [[0, 1], [2]]);
  assert.equal(buildGlacierStretches([crossing("A", 0, 100), crossing("A", 305, 400)]).length, 2);
});

test("off-ice gaps cannot make separate visits into a sliver or a border", () => {
  assert.deepEqual(rows(buildGlacierStretches([
    crossing("A", 0, 400), crossing("B", 500, 525), crossing("A", 600, 1000),
  ])), ["A", "B", "A"]);
  const input = sequence(["A", "B", "A", "B"], [100, 100, 100, 100])
    .map((c, i) => ({ ...c, entered_distance_m: c.entered_distance_m + i * 25,
      exited_distance_m: c.exited_distance_m + i * 25 }));
  assert.deepEqual(rows(buildGlacierStretches(input)), ["A", "B", "A", "B"]);
});

test("three-glacier jitter keeps every identity, ordered by share for a top-two plus-count label", () => {
  const stretches = buildGlacierStretches(sequence(["C", "A", "B", "A", "C", "B"], [50, 150, 100, 150, 50, 100]));
  assert.deepEqual(rows(stretches), ["A / B / C"]);
  const border = stretches[0];
  assert.equal(border.kind, "border");
  assert.deepEqual(border.destinations.map(d => d.share), [0.5, 1 / 3, 1 / 6]);
  const label = `${border.destinations.slice(0, 2).map(d => d.name).join(" / ")} +${border.destinations.length - 2}`;
  assert.equal(label, "A / B +1");
});

test("session segments never merge, even when their distances touch or reset", () => {
  for (const secondStart of [0, 100]) {
    const input = [crossing("A", 0, 100, { segment_number: 1 }),
      crossing("A", secondStart, secondStart + 100, { segment_number: 2 })];
    const stretches = buildGlacierStretches(input);
    assert.equal(stretches.length, 2);
    assert.deepEqual(stretches.map(s => s.segment_number), [1, 2]);
    assert.deepEqual(stretches.map(s => s.crossing_indexes), [[0], [1]]);
  }
});

test("route and session grouping agree; transition times use the last switch's exact endpoints", () => {
  const route = sequence(["A", "B", "A", "B", "A", "B"], [800, 80, 70, 80, 70, 800]);
  const time = (distance: number): string => new Date(Date.UTC(2026, 0, 1) + distance * 1000).toISOString();
  const session = route.map(c => ({ ...c, segment_number: 7,
    entered_at: time(c.entered_distance_m), exited_at: time(c.exited_distance_m) }));
  const stretches = buildGlacierStretches(session);
  assert.deepEqual(rows(stretches), rows(buildGlacierStretches(route)));
  assert.deepEqual(stretches.map(s => [s.entered_at, s.exited_at]), [[time(0), time(1100)], [time(1100), time(1900)]]);
  assert.ok(stretches.every(s => s.segment_number === 7));
});

test("session borders and short-gap merges retain outer times, including null time", () => {
  const borderInput = sequence(["B", "A", "B", "A"], [100, 100, 100, 100]).map((c, i) => ({ ...c,
    segment_number: 3, entered_at: `2026-01-01T00:0${i}:00.000Z`, exited_at: `2026-01-01T00:0${i + 1}:00.000Z` }));
  const [border] = buildGlacierStretches(borderInput);
  assert.equal(border.entered_at, borderInput[0].entered_at);
  assert.equal(border.exited_at, borderInput[3].exited_at);
  const [merged] = buildGlacierStretches([
    crossing("A", 0, 100, { segment_number: 3, entered_at: null, exited_at: borderInput[0].exited_at }),
    crossing("A", 150, 200, { segment_number: 3, entered_at: borderInput[1].entered_at, exited_at: borderInput[3].exited_at }),
  ]);
  assert.equal(merged.entered_at, null);
  assert.equal(merged.exited_at, borderInput[3].exited_at);
});

test("empty and single inputs preserve optional fields, nulls and zero elevations", () => {
  assert.deepEqual(buildGlacierStretches([]), []);
  assert.deepEqual(buildGlacierStretches([crossing("A", 10, 30, { min_elevation_m: 0 })]), [{
    kind: "glacier", destinations: [{ id: "A", name: "A", kind: "glacier", share: 1 }],
    entered_distance_m: 10, exited_distance_m: 30, min_elevation_m: 0, max_elevation_m: null, crossing_indexes: [0],
  }]);
  const [route] = buildGlacierStretches([crossing("A", 10, 30, { entered_at: null, exited_at: null, segment_number: 0 })]);
  assert.equal(route.entered_at, null);
  assert.equal(route.exited_at, null);
  assert.equal(route.segment_number, 0);
});

test("unsorted input keeps travel order and original indexes without changing the rows", () => {
  const input = sequence(["B", "A", "B", "A"], [100, 100, 100, 100]);
  const shuffled = [input[3], input[0], input[2], input[1]];
  const expected = buildGlacierStretches(input);
  const actual = buildGlacierStretches(shuffled);
  assert.deepEqual(actual, expected);
  const visits = buildGlacierStretches([crossing("B", 800, 1000), crossing("A", 0, 500)]);
  assert.deepEqual(rows(visits), ["A", "B"]);
  assert.deepEqual(visits.map(s => s.crossing_indexes), [[1], [0]]);
});

test("five-metre decision bins keep slivers and tied share order stable under sub-metre changes", () => {
  assert.equal(GLACIER_STRETCH_THRESHOLDS.decision_step_m, 5);
  for (const delta of [-0.1, 0.1]) {
    assert.deepEqual(rows(buildGlacierStretches(sequence(["A", "B", "A"], [300, 40 + delta, 300]))), ["A"]);
    const [border] = buildGlacierStretches(sequence(["B", "A", "B", "A"], [100 + delta, 100 - delta, 100, 100]));
    assert.deepEqual(border.destinations.map(d => [d.id, d.share]), [["A", 0.5], ["B", 0.5]]);
  }
});

test("overlapping outlines form border spans with unioned same-glacier support", () => {
  const stretches = buildGlacierStretches([
    crossing("A", 0, 600, { min_elevation_m: 10 }), crossing("A", 100, 500),
    crossing("B", 100, 500, { max_elevation_m: 200 }),
  ]);
  assert.deepEqual(rows(stretches), ["A / B"]);
  assert.deepEqual(stretches[0].destinations.map(d => d.share), [0.6, 0.4]);
  assert.deepEqual(stretches[0].crossing_indexes, [0, 1, 2]);
  assert.equal(stretches[0].min_elevation_m, 10);
  assert.equal(stretches[0].max_elevation_m, 200);
});

test("invalid or zero-length intervals cannot produce invalid stretches or renumber source indexes", () => {
  const stretches = buildGlacierStretches([
    crossing("A", 0, 0), crossing("A", Number.NaN, 100), crossing("A", 200, 100), crossing("B", 300, 400),
  ]);
  assert.deepEqual(rows(stretches), ["B"]);
  assert.deepEqual(stretches[0].crossing_indexes, [3]);
});
