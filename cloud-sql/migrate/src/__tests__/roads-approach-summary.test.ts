import { strict as assert } from "node:assert";
import { test } from "node:test";
import { summarizeApproach, type TraversalEdge } from "../roads/graph";

function edge(overrides: Partial<TraversalEdge> = {}): TraversalEdge {
  return {
    edgeId: "usfs_roadcore:{A}#1",
    segmentKey: "usfs_roadcore:{A}",
    fromNode: 1,
    toNode: 2,
    source: "usfs_roadcore",
    routeId: "3512",
    name: "FR 3512",
    lengthMiles: 1,
    vehicleRequirement: "passenger_car",
    vehicleRank: 1,
    surface: "aggregate",
    surfaceRank: 3,
    maintLevel: "ml3",
    maintLevelNum: 3,
    approachTerminus: false,
    ...overrides,
  };
}

test("the worst vehicle on the path wins, and names the segment that set it", () => {
  const summary = summarizeApproach([
    edge({ segmentKey: "usfs_roadcore:{A}" }),
    edge({
      edgeId: "usfs_roadcore:{B}#1@2",
      segmentKey: "usfs_roadcore:{B}",
      name: "FR 8040-500",
      vehicleRequirement: "high_clearance",
      vehicleRank: 2,
    }),
    edge({ segmentKey: "usfs_roadcore:{C}" }),
  ]);
  assert.equal(summary.vehicle!.value, "high_clearance");
  assert.equal(summary.vehicle!.limitingSegmentKey, "usfs_roadcore:{B}");
  assert.equal(summary.vehicle!.limitingName, "FR 8040-500");
});

test("the answer's evidence is the segment key, not the edge id", () => {
  // Edge ids carry an @piece suffix from the noding and are renumbered by any
  // source refresh; the segment key is the agency's own identifier.
  const summary = summarizeApproach([
    edge({
      edgeId: "blm_gtlf:28883#1@4",
      segmentKey: "blm_gtlf:28883",
      vehicleRequirement: "four_wheel_drive",
      vehicleRank: 3,
    }),
  ]);
  assert.equal(summary.vehicle!.limitingSegmentKey, "blm_gtlf:28883");
  assert.equal(summary.vehicle!.limitingEdgeId, "blm_gtlf:28883#1@4");
  assert.notEqual(summary.vehicle!.limitingSegmentKey, summary.vehicle!.limitingEdgeId);
});

test("one unranked edge makes the whole vehicle answer unknown", () => {
  // This is the trap. A plain maximum would report high_clearance here, which
  // reads as a confident answer about a path nobody has rated.
  const summary = summarizeApproach([
    edge({ vehicleRequirement: "high_clearance", vehicleRank: 2 }),
    edge({
      segmentKey: "blm_gtlf:99",
      source: "blm_gtlf",
      vehicleRequirement: null,
      vehicleRank: null,
    }),
  ]);
  assert.equal(summary.vehicle, null);
  assert.equal(summary.unrankedEdges, 1);
});

test("an unranked surface makes the surface answer unknown on its own", () => {
  const summary = summarizeApproach([
    edge({ surface: "native", surfaceRank: 5 }),
    edge({ surface: null, surfaceRank: null }),
  ]);
  assert.equal(summary.surface, null);
  assert.equal(summary.unsurfacedEdges, 1);
  // The vehicle answer is untouched — the two are judged apart.
  assert.equal(summary.vehicle!.value, "passenger_car");
});

test("a missing length makes the distance unknown, never zero", () => {
  const summary = summarizeApproach([
    edge({ lengthMiles: 6.2 }),
    edge({ lengthMiles: null }),
    edge({ lengthMiles: 3 }),
  ]);
  assert.equal(summary.lengthMiles, null);
  assert.equal(summary.unmeasuredEdges, 1);
});

test("a fully known path adds its lengths up", () => {
  const summary = summarizeApproach([edge({ lengthMiles: 6.2 }), edge({ lengthMiles: 3.3 })]);
  assert.ok(Math.abs(summary.lengthMiles! - 9.5) < 1e-9);
  assert.equal(summary.unmeasuredEdges, 0);
});

test("segments are listed once each, in the order the walk met them", () => {
  const summary = summarizeApproach([
    edge({ segmentKey: "usfs_roadcore:{A}", edgeId: "usfs_roadcore:{A}#1@0" }),
    edge({ segmentKey: "usfs_roadcore:{A}", edgeId: "usfs_roadcore:{A}#1@1" }),
    edge({ segmentKey: "usfs_roadcore:{B}" }),
  ]);
  assert.deepEqual(summary.segmentKeys, ["usfs_roadcore:{A}", "usfs_roadcore:{B}"]);
});

test("an empty path is unknown everywhere, and zero miles of nothing", () => {
  const summary = summarizeApproach([]);
  assert.equal(summary.vehicle, null);
  assert.equal(summary.surface, null);
  assert.equal(summary.lengthMiles, 0);
  assert.deepEqual(summary.segmentKeys, []);
});
