import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRouteSegmentsWithClient, type SegmentMatcherClient } from "./segment-matcher-core";
import type { TrackPoint } from "./route-utils";

const line = (count: number, step = 0.0001): TrackPoint[] => Array.from({ length: count }, (_, i) =>
  ({ lat: 47 + i * step, lng: -121, ele: 100 + i, dist: 0 }));
const xyz = (points: TrackPoint[]) => points.map(({ lng, lat, ele }) => [lng, lat, ele]);
function fixture(segments: Array<{ id: string; points: TrackPoint[] }>) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client: SegmentMatcherClient = { async query(text, values) {
    queries.push({ text, values });
    if (text.includes("FROM segments s")) return { rows: segments.map(({ id, points }) =>
      ({ id, name: id, distance: 100, geojson: JSON.stringify({ type: "LineString", coordinates: xyz(points) }) })) };
    if (text.includes("FROM route_segments rs")) return { rows: [] };
    throw new Error(`Unexpected query: ${text}`);
  } };
  return { client, queries };
}
const automatic = { exactOnly: true, allowExistingSplits: false };

test("first import cuts every source seam and graph junction without changing XYZ", async () => {
  const points = line(6);
  const { client, queries } = fixture([]);
  const result = await analyzeRouteSegmentsWithClient(client, points, { ...automatic, requiredCutIndices: [3, 1, 3] });
  assert.deepEqual(result.segments.map(segment => [segment.type, segment.routeStartIndex, segment.routeEndIndex]),
    [["new", 0, 1], ["new", 1, 3], ["new", 3, 5]]);
  const assembled = result.segments.flatMap((segment, index) => index ? segment.points.slice(1) : segment.points);
  assert.deepEqual(xyz(assembled), xyz(points));
  assert.deepEqual(result.splits, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /ST_AsGeoJSON\(s.path::geometry, 15\)/);
});

test("an exact stored span shorter than 50 m reuses in both directions", async () => {
  const points = line(3);
  for (const reverse of [false, true]) {
    const input = reverse ? [...points].reverse() : points;
    const { client } = fixture([{ id: "shared", points }]);
    const result = await analyzeRouteSegmentsWithClient(client, input, automatic);
    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].existingSegmentId, "shared");
    assert.equal(result.segments[0].direction, reverse ? "reverse" : "forward");
    assert.deepEqual(xyz(result.segments[0].points), xyz(input));
  }
});

test("adjacent stored segments share their boundary vertex without a new gap", async () => {
  const points = line(5);
  const { client } = fixture([{ id: "first", points: points.slice(0, 3) }, { id: "second", points: points.slice(2) }]);
  const result = await analyzeRouteSegmentsWithClient(client, points, automatic);
  assert.deepEqual(result.segments.map(segment => [segment.existingSegmentId, segment.routeStartIndex, segment.routeEndIndex]),
    [["first", 0, 2], ["second", 2, 4]]);
});

test("the same physical segment can occur forward and reverse in one route", async () => {
  const points = line(3);
  const input = [...points, points[1], points[0]];
  const { client } = fixture([{ id: "shared", points }]);
  const result = await analyzeRouteSegmentsWithClient(client, input, automatic);
  assert.deepEqual(result.segments.map(segment => [segment.existingSegmentId, segment.direction]),
    [["shared", "forward"], ["shared", "reverse"]]);
});

test("closed and repeated-vertex stored paths preserve their source vertex order", async () => {
  const p = line(3);
  for (const points of [[p[0], p[1], p[2], p[0]], [p[0], p[1], p[0], p[2]]]) {
    for (const reverse of [false, true]) {
      const input = reverse ? [...points].reverse() : points;
      const { client } = fixture([{ id: "shared", points }]);
      const result = await analyzeRouteSegmentsWithClient(client, input, automatic);
      assert.equal(result.segments.length, 1);
      assert.equal(result.segments[0].existingSegmentId, "shared");
      assert.equal(result.segments[0].direction, reverse ? "reverse" : "forward");
      assert.deepEqual(xyz(result.segments[0].points), xyz(input));
    }
  }
});

test("automatic import rejects existing partial spans and required cuts inside stored rows", async () => {
  const points = line(5);
  const { client } = fixture([{ id: "shared", points }]);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, points.slice(1, 4), automatic),
    /existing_segment_split_requires_review:shared/);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, points, { ...automatic, requiredCutIndices: [2] }),
    /existing_segment_split_requires_review:shared/);
});

test("conflict trimming recomputes exact source bounds and unrounded fractions", async () => {
  const points = line(11, 0.001);
  const { client } = fixture([{ id: "long", points: points.slice(0, 7) }, { id: "overlap", points: points.slice(4) }]);
  const result = await analyzeRouteSegmentsWithClient(client, points, { exactOnly: true });
  const trimmed = result.segments.find(segment => segment.parentSegmentId === "overlap")!;
  assert.equal(trimmed.routeStartIndex, 6);
  assert.equal(trimmed.routeEndIndex, 10);
  assert.equal(trimmed.segmentStartIndex, 2);
  assert.equal(trimmed.segmentEndIndex, 6);
  assert.ok(trimmed.startFraction! > 0.33 && trimmed.startFraction! < 0.34);
  const split = result.splits.find(item => item.originalSegmentId === "overlap")!;
  assert.deepEqual(split.vertexIndices, [2]);
  assert.equal(split.originalPointCount, 7);
  assert.equal(split.fractions[0], trimmed.startFraction);
  assert.notEqual(split.fractions[0], Math.round(split.fractions[0] * 10000) / 10000);
});

test("mostly claimed exact spans still require a reviewed split instead of new geometry", async () => {
  const points = line(9);
  const { client } = fixture([{ id: "first", points: points.slice(0, 7) },
    { id: "overlap", points: points.slice(2) }]);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, points, automatic),
    /existing_segment_split_requires_review:overlap/);
  const result = await analyzeRouteSegmentsWithClient(client, points, { exactOnly: true });
  assert.ok(result.segments.every(segment => segment.type !== "new"));
  assert.deepEqual(result.segments.map(segment => [segment.routeStartIndex, segment.routeEndIndex]), [[0, 6], [6, 8]]);
});

test("full and partial occurrences of one parent both reference its split pieces", async () => {
  const points = line(3);
  const input = [...points, points[1]];
  const { client } = fixture([{ id: "shared", points }]);
  const result = await analyzeRouteSegmentsWithClient(client, input, { exactOnly: true });
  assert.deepEqual(result.splits[0].vertexIndices, [1]);
  assert.deepEqual(result.segments.map(segment => [segment.type, segment.parentSegmentId,
    segment.segmentStartIndex, segment.segmentEndIndex, segment.direction]),
  [["split", "shared", 0, 2, "forward"], ["split", "shared", 1, 2, "reverse"]]);
  assert.ok(result.segments.every(segment => !segment.existingSegmentId));
});

test("nearby geometry, changed Z, and a skipped source vertex do not count as exact reuse", async () => {
  const points = line(5);
  for (const input of [points.map(point => ({ ...point, ele: point.ele + 1 })),
    points.map(point => ({ ...point, lng: point.lng + 0.0001 })), [points[0], points[4]]]) {
    const { client } = fixture([{ id: "shared", points }]);
    const result = await analyzeRouteSegmentsWithClient(client, input, automatic);
    assert.ok(result.segments.every(segment => segment.type === "new"));
  }
});

test("web review keeps proximity proposals while short inexact spans stay new", async () => {
  for (const step of [0.001, 0.0001]) {
    const stored = line(3, step);
    const nearby = stored.map(point => ({ ...point, lng: point.lng + 0.00005 }));
    const { client } = fixture([{ id: "nearby", points: stored }]);
    const result = await analyzeRouteSegmentsWithClient(client, nearby);
    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].type, step === 0.001 ? "existing" : "new");
    assert.deepEqual(xyz(result.segments[0].points), xyz(nearby));
  }
});

test("invalid route geometry and cut indices fail before querying", async () => {
  const { client, queries } = fixture([]);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, []), /two_vertices/);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, line(3), { requiredCutIndices: [1.5] }), /cut_index_invalid/);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, line(3), { requiredCutIndices: [3] }), /cut_index_invalid/);
  await assert.rejects(analyzeRouteSegmentsWithClient(client, line(3).map(point => ({ ...point, ele: NaN }))), /geometry_invalid/);
  assert.equal(queries.length, 0);
});

test("database failures propagate instead of hiding unmatched segments", async () => {
  const client: SegmentMatcherClient = { async query() { throw new Error("database unavailable"); } };
  await assert.rejects(analyzeRouteSegmentsWithClient(client, line(3), automatic), /database unavailable/);
});
