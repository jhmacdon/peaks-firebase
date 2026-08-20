import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  deriveApproach,
  findApproachPath,
  humanSegmentRef,
  intersectSeasonWindows,
  longestWindow,
  seasonWindowToIsoDates,
  surfaceWord,
  vehicleAnswerFor,
  type WalkGraph,
} from "../roads/approach";
import { buildAdjacency, type SnapCandidate, type TraversalEdge } from "../roads/graph";
import type { SeasonWindow } from "../roads/mvum-seasons";

function edge(overrides: Partial<TraversalEdge> = {}): TraversalEdge {
  return {
    edgeId: "usfs_roadcore:{A}#1",
    segmentKey: "usfs_roadcore:{A}",
    fromNode: 1,
    toNode: 2,
    source: "usfs_roadcore",
    routeId: "3512000",
    name: "SPUR",
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

function window(opens: string, closes: string): SeasonWindow {
  return { opens, closes, wrapsYear: closes < opens };
}

/** A graph whose nodes sit on a line of latitude, a mile apart. */
function lineGraph(edges: TraversalEdge[]): WalkGraph {
  const nodes = new Map<number, { lon: number; lat: number }>();
  for (const item of edges) {
    for (const node of [item.fromNode, item.toNode]) {
      // 0.0145 degrees of longitude is about a mile at this latitude.
      if (!nodes.has(node)) nodes.set(node, { lon: -121 + node * 0.0145, lat: 46 });
    }
  }
  return {
    adjacency: buildAdjacency(edges),
    byId: new Map(edges.map((item) => [item.edgeId, item])),
    nodes,
  };
}

function snapTo(edgeId: string, position = 0.5): SnapCandidate {
  return {
    edgeId,
    segmentKey: edgeId.split("#")[0]!,
    source: "usfs_roadcore",
    routeId: null,
    name: null,
    fromNode: 0,
    toNode: 0,
    distanceMetres: 12,
    positionAlongEdge: position,
    vehicleRequirement: null,
    vehicleRank: null,
    surface: null,
    surfaceRank: null,
    maintLevel: null,
    maintLevelNum: null,
  };
}

// ---------------------------------------------------------------------------
// Seasonal windows
// ---------------------------------------------------------------------------

test("windows crossed on the path are intersected, not picked from", () => {
  const intersection = intersectSeasonWindows([
    [window("04-01", "11-30")],
    [window("05-15", "10-15")],
  ]);
  assert.deepEqual(intersection, [{ opens: "05-15", closes: "10-15", wrapsYear: false }]);
});

test("a segment with no window is not a constraint and not an open gate", () => {
  // The empty set is dropped rather than intersected — intersecting it would
  // close the road, and treating it as the whole year would open it.
  const intersection = intersectSeasonWindows([[window("06-01", "09-30")], []]);
  assert.deepEqual(intersection, [{ opens: "06-01", closes: "09-30", wrapsYear: false }]);
});

test("windows that never overlap leave nothing", () => {
  assert.deepEqual(
    intersectSeasonWindows([[window("01-01", "03-31")], [window("07-01", "09-30")]]),
    [],
  );
});

test("a window through New Year survives the intersection as one span", () => {
  const intersection = intersectSeasonWindows([
    [window("11-01", "04-30")],
    [window("12-01", "03-31")],
  ]);
  assert.equal(intersection.length, 1);
  assert.deepEqual(intersection[0], { opens: "12-01", closes: "03-31", wrapsYear: true });
});

test("two windows on one segment are read together, not one at a time", () => {
  // "01/01-10/11 10/22-12/31" is a real eleven-day closure, not two roads.
  const intersection = intersectSeasonWindows([
    [window("01-01", "10-11"), window("10-22", "12-31")],
    [window("05-01", "12-31")],
  ]);
  assert.deepEqual(intersection, [
    { opens: "05-01", closes: "10-11", wrapsYear: false },
    { opens: "10-22", closes: "12-31", wrapsYear: false },
  ]);
  assert.deepEqual(longestWindow(intersection), {
    opens: "05-01",
    closes: "10-11",
    wrapsYear: false,
  });
});

test("an intersection that covers the year is reported as no window at all", () => {
  // §A3: a road open every day is the filler value, not a fact about a gate.
  assert.deepEqual(
    intersectSeasonWindows([[window("01-01", "06-30"), window("07-01", "12-31")]]),
    [],
  );
});

test("a stored window is an ISO date, never MM/DD", () => {
  const iso = seasonWindowToIsoDates(window("04-02", "11-30"), 2026);
  assert.deepEqual(iso, { opens: "2026-04-02", closes: "2026-11-30" });
  assert.match(iso!.opens, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(iso!.closes, /^\d{4}-\d{2}-\d{2}$/);
});

test("a window through New Year closes in the following year", () => {
  assert.deepEqual(seasonWindowToIsoDates(window("05-16", "03-14"), 2026), {
    opens: "2026-05-16",
    closes: "2027-03-14",
  });
});

test("a leap day is kept by moving the year, not the day", () => {
  // 2026 is not a leap year, and 02-28 would be a different fact.
  assert.deepEqual(seasonWindowToIsoDates(window("02-29", "06-01"), 2026), {
    opens: "2028-02-29",
    closes: "2028-06-01",
  });
});

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

test("maintenance levels 3, 4 and 5 do not ask for high clearance", () => {
  // §A3: the difference between those levels is comfort, not capability, and
  // the surface leaf beside this one carries the roughness.
  assert.deepEqual(vehicleAnswerFor("passenger_car"), {
    highClearance: "not_required",
    fourWheelDrive: false,
    carPassable: true,
  });
});

test("a high-clearance road claims nothing about four-wheel drive", () => {
  assert.deepEqual(vehicleAnswerFor("high_clearance"), {
    highClearance: "required",
    fourWheelDrive: null,
    carPassable: true,
  });
});

test("a four-wheel-drive road needs the clearance that comes with it", () => {
  for (const requirement of ["four_wheel_drive", "four_wheel_drive_high_clearance"] as const) {
    assert.deepEqual(vehicleAnswerFor(requirement), {
      highClearance: "required",
      fourWheelDrive: true,
      carPassable: true,
    });
  }
});

test("an ATV route is not a drive, so it makes no vehicle claim", () => {
  for (const requirement of ["atv_only", "not_maintained"] as const) {
    const answer = vehicleAnswerFor(requirement);
    assert.equal(answer.carPassable, false);
    assert.equal(answer.highClearance, null);
    assert.equal(answer.fourWheelDrive, null);
  }
});

test("the surface is a word a driver uses", () => {
  assert.equal(surfaceWord("asphalt"), "paved");
  assert.equal(surfaceWord("aggregate"), "gravel");
  assert.equal(surfaceWord("native"), "dirt");
  assert.equal(surfaceWord("improved_native"), "improved dirt");
  assert.equal(surfaceWord("other"), null);
});

test("a Forest Service spur is written the way the agency writes it", () => {
  const of = (routeId: string | null, name: string | null = null): string =>
    humanSegmentRef({ source: "usfs_roadcore", routeId, name, segmentKey: "usfs_roadcore:{A}" });
  assert.equal(of("8040500"), "FR 8040-500");
  assert.equal(of("8040000"), "FR 8040");
  // The ids are not all seven digits, and inventing a hyphen inside "34N17"
  // would name a road that does not exist.
  assert.equal(of("34N17"), "FR 34N17");
  assert.equal(of("505.1"), "FR 505.1");
  assert.equal(of(null, "COLD SPRINGS"), "COLD SPRINGS");
  assert.equal(of(null, null), "usfs_roadcore:{A}");
});

test("a BLM road is named, because its route number means nothing to a driver", () => {
  const of = (routeId: string | null, name: string | null): string =>
    humanSegmentRef({ source: "blm_gtlf", routeId, name, segmentKey: "blm_gtlf:159441" });
  assert.equal(of("1887", "Huasna Rd."), "Huasna Rd.");
  assert.equal(of("3688", null), "BLM route 3688");
  assert.equal(of(null, null), "blm_gtlf:159441");
});

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

test("the walk stops at the first level 4/5 road and carries it on the path", () => {
  const graph = lineGraph([
    edge({ edgeId: "s#1", segmentKey: "s", fromNode: 1, toNode: 2 }),
    edge({ edgeId: "m#1", segmentKey: "m", fromNode: 2, toNode: 3 }),
    edge({
      edgeId: "a#1",
      segmentKey: "a",
      fromNode: 3,
      toNode: 4,
      maintLevel: "ml4",
      maintLevelNum: 4,
      approachTerminus: true,
    }),
  ]);
  const walk = findApproachPath(graph, snapTo("s#1"), { lon: -121, lat: 46 });
  assert.ok(walk !== null);
  assert.deepEqual(walk.edges.map((item) => item.segmentKey), ["s", "m", "a"]);
  assert.equal(walk.anchor.segmentKey, "a");
});

test("the drive counts the part of the spur actually driven, and not the anchor", () => {
  const graph = lineGraph([
    edge({ edgeId: "s#1", segmentKey: "s", fromNode: 1, toNode: 2, lengthMiles: 2 }),
    edge({
      edgeId: "a#1",
      segmentKey: "a",
      fromNode: 2,
      toNode: 3,
      lengthMiles: 9,
      maintLevelNum: 4,
      approachTerminus: true,
    }),
  ]);
  // Snapped a quarter of the way along the two-mile spur, driving out through
  // node 2: one and a half miles, and none of the nine-mile anchor.
  const walk = findApproachPath(graph, snapTo("s#1", 0.25), { lon: -121, lat: 46 });
  assert.equal(walk!.driveMiles, 1.5);
});

test("a trailhead already on a maintained road has a zero-mile approach", () => {
  const graph = lineGraph([
    edge({ edgeId: "a#1", segmentKey: "a", fromNode: 1, toNode: 2, maintLevelNum: 5, approachTerminus: true }),
  ]);
  const walk = findApproachPath(graph, snapTo("a#1"), { lon: -121, lat: 46 });
  assert.equal(walk!.driveMiles, 0);
  assert.deepEqual(walk!.edges.map((item) => item.segmentKey), ["a"]);
});

test("a missing length makes the drive unknown, never short", () => {
  const graph = lineGraph([
    edge({ edgeId: "s#1", segmentKey: "s", fromNode: 1, toNode: 2, lengthMiles: null }),
    edge({ edgeId: "a#1", segmentKey: "a", fromNode: 2, toNode: 3, maintLevelNum: 4, approachTerminus: true }),
  ]);
  const walk = findApproachPath(graph, snapTo("s#1"), { lon: -121, lat: 46 });
  assert.equal(walk!.driveMiles, null);
});

test("the walk gives up rather than wandering past the straight-line bound", () => {
  const graph = lineGraph([
    edge({ edgeId: "s#1", segmentKey: "s", fromNode: 1, toNode: 2 }),
    edge({ edgeId: "m#1", segmentKey: "m", fromNode: 2, toNode: 3 }),
    edge({ edgeId: "a#1", segmentKey: "a", fromNode: 3, toNode: 4, maintLevelNum: 4, approachTerminus: true }),
  ]);
  const walk = findApproachPath(graph, snapTo("s#1"), { lon: -121, lat: 46 }, {
    maxStraightLineMetres: 100,
  });
  assert.equal(walk, null);
});

test("an unanchored component yields no approach rather than a guess", () => {
  const graph = lineGraph([
    edge({ edgeId: "s#1", segmentKey: "s", fromNode: 1, toNode: 2 }),
    edge({ edgeId: "m#1", segmentKey: "m", fromNode: 2, toNode: 3 }),
  ]);
  assert.equal(findApproachPath(graph, snapTo("s#1"), { lon: -121, lat: 46 }), null);
});

test("nearest takes the short rough way; easiest takes the graded way round", () => {
  // Two ways out of the same spur: one mile of high-clearance road, or three
  // miles of passenger-car road. A driver takes the graded one.
  const edges = [
    edge({ edgeId: "s#1", segmentKey: "s", fromNode: 1, toNode: 2, lengthMiles: 0.2 }),
    edge({
      edgeId: "rough#1",
      segmentKey: "rough",
      fromNode: 2,
      toNode: 3,
      lengthMiles: 1,
      vehicleRequirement: "high_clearance",
      vehicleRank: 2,
      maintLevel: "ml2",
      maintLevelNum: 2,
    }),
    edge({ edgeId: "long#1", segmentKey: "long", fromNode: 2, toNode: 4, lengthMiles: 3 }),
    edge({ edgeId: "a1#1", segmentKey: "a1", fromNode: 3, toNode: 5, maintLevelNum: 4, approachTerminus: true }),
    edge({ edgeId: "a2#1", segmentKey: "a2", fromNode: 4, toNode: 6, maintLevelNum: 4, approachTerminus: true }),
  ];
  const graph = lineGraph(edges);
  const origin = { lon: -121, lat: 46 };
  const nearest = findApproachPath(graph, snapTo("s#1"), origin, { prefer: "nearest" });
  assert.deepEqual(nearest!.edges.map((item) => item.segmentKey), ["s", "rough", "a1"]);
  const easiest = findApproachPath(graph, snapTo("s#1"), origin, { prefer: "easiest" });
  assert.deepEqual(easiest!.edges.map((item) => item.segmentKey), ["s", "long", "a2"]);
});

// ---------------------------------------------------------------------------
// Folding the path into an answer
// ---------------------------------------------------------------------------

test("a path through an unrated BLM road has no vehicle answer", () => {
  // The negative case the production data cannot exercise: no trailhead that
  // reaches an anchor today crosses BLM ground, and 55% of BLM edges have no
  // observed class at all. A plain maximum would publish "high clearance" here.
  const derived = deriveApproach([
    edge({ vehicleRequirement: "high_clearance", vehicleRank: 2, maintLevel: "ml2" }),
    edge({
      edgeId: "blm_gtlf:28883#1@4",
      segmentKey: "blm_gtlf:28883",
      source: "blm_gtlf",
      vehicleRequirement: null,
      vehicleRank: null,
      surface: null,
      surfaceRank: null,
    }),
    edge({ maintLevelNum: 4, approachTerminus: true }),
  ]);
  assert.equal(derived.vehicle, null);
  assert.equal(derived.surface, null);
  assert.equal(derived.skipReason, "unranked_path");
  assert.equal(derived.summary.unrankedEdges, 1);
});

test("the stored evidence is the agency's segment key, not this build's edge id", () => {
  const derived = deriveApproach([
    edge({
      edgeId: "usfs_roadcore:{B}#1@7",
      segmentKey: "usfs_roadcore:{B}",
      routeId: "8040500",
      vehicleRequirement: "high_clearance",
      vehicleRank: 2,
    }),
    edge({ maintLevelNum: 4, approachTerminus: true }),
  ]);
  assert.equal(derived.limiting!.segmentKey, "usfs_roadcore:{B}");
  assert.notEqual(derived.limiting!.segmentKey, "usfs_roadcore:{B}#1@7");
  assert.equal(humanSegmentRef(derived.limiting!), "FR 8040-500");
});

test("an ATV-only stretch is reported as no drive, not as four-wheel drive", () => {
  const derived = deriveApproach([
    edge({
      segmentKey: "blm_gtlf:1",
      source: "blm_gtlf",
      vehicleRequirement: "atv_only",
      vehicleRank: 5,
    }),
    edge({ maintLevelNum: 4, approachTerminus: true }),
  ]);
  assert.equal(derived.vehicle!.carPassable, false);
  assert.equal(derived.skipReason, "not_car_passable");
});
