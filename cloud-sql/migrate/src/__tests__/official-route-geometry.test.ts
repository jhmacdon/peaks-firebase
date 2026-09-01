import assert from "node:assert/strict";
import test from "node:test";
import {
  ArcgisTrailService,
  buildOfficialArcgisQueryUrl,
  buildOfficialRoutePath,
  collectOfficialPathMetadata,
  ensureMinimumRouteCoordinates,
  isSimpleClosedRoute,
  normalizeOfficialFeatureIds,
  parseOfficialFeatureIdsFromSourceUrl,
  parseOfficialArcgisPaths,
  reviewLollipopRetrace,
  reviewOfficialRouteGeometry,
} from "../official-route-geometry";

const service: ArcgisTrailService = {
  queryUrl: "https://example.test/arcgis/rest/services/trails/FeatureServer/0/query",
  idField: "TRAIL_ID",
  nameFields: ["TRAIL_NAME", "ALT_NAME"],
  accessFields: ["STATUS", "ACCESS"],
};

test("shared densification preserves one-edge and two-vertex route geometry", () => {
  const cases: Array<Array<[number, number]>> = [
    [
      [-122.001, 47],
      [-122, 47],
      [-121.99, 47],
      [-121.989, 47],
    ],
    [
      [179.99, 0],
      [-179.99, 0],
    ],
  ];

  for (const original of cases) {
    const densified = ensureMinimumRouteCoordinates(original, 5);
    assert.equal(densified.length, 5);
    assert.deepEqual(densified[0], original[0]);
    assert.deepEqual(densified.at(-1), original.at(-1));

    let searchFrom = 0;
    for (const coordinate of original) {
      const preservedIndex = densified.findIndex(
        (candidate, index) =>
          index >= searchFrom &&
          candidate[0] === coordinate[0] &&
          candidate[1] === coordinate[1]
      );
      assert.notEqual(preservedIndex, -1);
      searchFrom = preservedIndex + 1;
    }
  }
});

test("official feature IDs and ArcGIS query URLs are stable", () => {
  assert.deepEqual(normalizeOfficialFeatureIds(["z-2", "a'1"]), ["a'1", "z-2"]);
  const url = buildOfficialArcgisQueryUrl(service, ["z-2", "a'1"]);
  assert.equal(url.searchParams.get("where"), "TRAIL_ID IN ('a''1','z-2')");
  assert.equal(
    url.searchParams.get("outFields"),
    "TRAIL_ID,TRAIL_NAME,ALT_NAME,STATUS,ACCESS"
  );
  assert.equal(url.searchParams.get("returnGeometry"), "true");
  assert.equal(url.searchParams.get("outSR"), "4326");
  assert.deepEqual(parseOfficialFeatureIdsFromSourceUrl(service, url.toString()), [
    "a'1",
    "z-2",
  ]);
  const changed = new URL(url);
  changed.searchParams.set("outSR", "3857");
  assert.throws(
    () => parseOfficialFeatureIdsFromSourceUrl(service, changed.toString()),
    /not the canonical registry query/
  );
  assert.throws(
    () => normalizeOfficialFeatureIds(["same", "same"]),
    /must be unique/
  );
});

test("ArcGIS paths use case-insensitive fields and require every stable ID", () => {
  const paths = parseOfficialArcgisPaths(
    {
      features: [
        {
          properties: {
            trail_id: "b",
            trail_name: "Summit Trail",
            status: "Open",
          },
          geometry: {
            type: "LineString",
            coordinates: [[0.002, 0], [0.003, 0]],
          },
        },
        {
          properties: {
            TRAIL_ID: "b",
            ALT_NAME: "Summit Trail",
            ACCESS: "Open",
          },
          geometry: {
            type: "LineString",
            coordinates: [[0.001, 0], [0.002, 0]],
          },
        },
        {
          properties: {
            TRAIL_ID: "a",
            TRAIL_NAME: "Approach",
            ACCESS: "Foot only",
          },
          geometry: {
            type: "LineString",
            coordinates: [[0, 0], [0.001, 0]],
          },
        },
      ],
    },
    service,
    ["b", "a"]
  );
  assert.deepEqual(paths.map(({ featureId }) => featureId), ["a", "b", "b"]);
  assert.deepEqual(collectOfficialPathMetadata(paths), {
    names: ["Approach", "Summit Trail"],
    access: ["Foot only", "Open"],
  });
  assert.throws(
    () =>
      parseOfficialArcgisPaths(
        { features: [
          {
            properties: { TRAIL_ID: "a" },
            geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          },
        ] },
        service,
        ["a", "b"]
      ),
    /omitted features: b/
  );
});

test("official route search is repeatable and cites only contributing features", () => {
  const paths = parseOfficialArcgisPaths(
    {
      features: [
        {
          properties: { TRAIL_ID: "unused", TRAIL_NAME: "Elsewhere" },
          geometry: {
            type: "LineString",
            coordinates: [[1, 1], [1.001, 1]],
          },
        },
        {
          properties: { TRAIL_ID: "upper", TRAIL_NAME: "Upper", STATUS: "Open" },
          geometry: {
            type: "LineString",
            coordinates: [[0.003, 0], [0.0055, 0]],
          },
        },
        {
          properties: { TRAIL_ID: "lower", TRAIL_NAME: "Lower", ACCESS: "Public" },
          geometry: {
            type: "LineString",
            coordinates: [[0.0005, 0], [0.003, 0]],
          },
        },
      ],
    },
    service,
    ["upper", "unused", "lower"]
  );
  const route = buildOfficialRoutePath(
    paths,
    { lng: 0, lat: 0 },
    { lng: 0.006, lat: 0 }
  );
  assert.deepEqual(route.usedFeatureIds, ["lower", "upper"]);
  assert.equal(route.coordinates.length, 5);
  assert.ok(route.trailheadSnapM > 50 && route.trailheadSnapM < 60);
  assert.ok(route.summitSnapM > 50 && route.summitSnapM < 60);

  const review = reviewOfficialRouteGeometry(
    route.coordinates.map(([lng, lat]) => ({ lng, lat })),
    route.usedPaths,
    route.usedFeatureIds
  );
  assert.equal(review.unusedFeatureIds.length, 0);
  assert.equal(review.coreCoveragePct, 100);
  assert.ok(review.coreMaxOffsetM < 0.01);
  assert.ok(review.startConnectorM > 50 && review.startConnectorM < 60);
  assert.ok(review.endConnectorM > 50 && review.endConnectorM < 60);
  assert.ok(review.startConnectorJoinOffsetM < 0.01);
  assert.ok(review.endConnectorJoinOffsetM < 0.01);

  const withUnusedCitation = reviewOfficialRouteGeometry(
    route.coordinates.map(([lng, lat]) => ({ lng, lat })),
    paths,
    ["lower", "upper", "unused"]
  );
  assert.deepEqual(withUnusedCitation.unusedFeatureIds, ["unused"]);
});

test("official route search splits a source line at interior place projections", () => {
  const paths = [
    {
      featureId: "ridge",
      properties: {},
      coordinates: [[0, 0], [0.005, 0], [0.01, 0]] as Array<[number, number]>,
      names: ["Ridge Trail"],
      access: ["Open"],
    },
  ];
  const route = buildOfficialRoutePath(
    paths,
    { lng: 0.002, lat: 0.0001 },
    { lng: 0.008, lat: -0.0001 }
  );

  assert.deepEqual(route.usedFeatureIds, ["ridge"]);
  assert.ok(route.trailheadSnapM > 11 && route.trailheadSnapM < 12);
  assert.ok(route.summitSnapM > 11 && route.summitSnapM < 12);
  assert.ok(Math.abs(route.coordinates[1][0] - 0.002) < 1e-10);
  assert.ok(Math.abs(route.coordinates[1][1]) < 1e-12);
  assert.ok(Math.abs(route.coordinates.at(-2)![0] - 0.008) < 1e-10);
  assert.ok(Math.abs(route.coordinates.at(-2)![1]) < 1e-12);
  assert.ok(
    !route.coordinates.some(([lng, lat]) => lng === 0 && lat === 0),
    "the route must not detour to the source feature endpoint"
  );
  assert.ok(
    !route.coordinates.some(([lng, lat]) => lng === 0.01 && lat === 0),
    "the route must leave the source line at the summit projection"
  );
});

test("official route search emits an importable point count for one straight line", () => {
  const paths = [
    {
      featureId: "straight",
      properties: {},
      coordinates: [[0.001, 0], [0.009, 0]] as Array<[number, number]>,
      names: ["Straight Trail"],
      access: ["Open"],
    },
  ];
  const route = buildOfficialRoutePath(
    paths,
    { lng: 0, lat: 0 },
    { lng: 0.01, lat: 0 }
  );

  assert.equal(route.coordinates.length, 5);
  assert.deepEqual(route.coordinates[0], [0, 0]);
  assert.deepEqual(route.coordinates.at(-1), [0.01, 0]);
  assert.deepEqual(route.usedFeatureIds, ["straight"]);
});

test("official route search rejects endpoint connectors over the approval cap", () => {
  const paths = [
    {
      featureId: "too-far",
      properties: {},
      coordinates: [[0.0012, 0], [0.009, 0]] as Array<[number, number]>,
      names: ["Too Far Trail"],
      access: ["Open"],
    },
  ];

  assert.throws(
    () =>
      buildOfficialRoutePath(
        paths,
        { lng: 0, lat: 0 },
        { lng: 0.01, lat: 0 }
      ),
    /do not connect/
  );
});

test("official route search does not infer topology from a 2-D crossing", () => {
  const paths = [
    {
      featureId: "east-west",
      properties: {},
      coordinates: [[0, 0], [0.01, 0]] as Array<[number, number]>,
      names: ["East-West Trail"],
      access: ["Open"],
    },
    {
      featureId: "north-south",
      properties: {},
      coordinates: [[0.005, -0.005], [0.005, 0.005]] as Array<
        [number, number]
      >,
      names: ["North-South Trail"],
      access: ["Open"],
    },
  ];
  assert.throws(
    () =>
      buildOfficialRoutePath(
        paths,
        { lng: 0, lat: 0 },
        { lng: 0.005, lat: 0.005 }
      ),
    /do not connect/
  );
});

test("official route search joins a nearby feature endpoint to a line interior", () => {
  const paths = [
    {
      featureId: "branch",
      properties: {},
      coordinates: [
        [0.005, 0.00004],
        [0.005, 0.003],
        [0.005, 0.005],
      ] as Array<[number, number]>,
      names: ["Branch Trail"],
      access: ["Open"],
    },
    {
      featureId: "trunk",
      properties: {},
      coordinates: [[0, 0], [0.01, 0]] as Array<[number, number]>,
      names: ["Trunk Trail"],
      access: ["Open"],
    },
  ];
  const route = buildOfficialRoutePath(
    paths,
    { lng: 0, lat: 0 },
    { lng: 0.005, lat: 0.005 }
  );

  assert.deepEqual(route.usedFeatureIds, ["branch", "trunk"]);
  assert.ok(route.largestConnectionM > 4 && route.largestConnectionM < 5);
  const review = reviewOfficialRouteGeometry(
    route.coordinates.map(([lng, lat]) => ({ lng, lat })),
    route.usedPaths,
    route.usedFeatureIds
  );
  assert.ok(review.coreMaxOffsetM < 3);
  assert.equal(review.coreCoveragePct, 100);
  assert.equal(review.sourceTopologyValid, true);
});

test("official route search rejects unsafe internal source gaps", () => {
  const paths = [
    {
      featureId: "branch",
      properties: {},
      coordinates: [[0.005, 0.00027], [0.005, 0.005]] as Array<
        [number, number]
      >,
      names: ["Branch Trail"],
      access: ["Open"],
    },
    {
      featureId: "trunk",
      properties: {},
      coordinates: [[0, 0], [0.01, 0]] as Array<[number, number]>,
      names: ["Trunk Trail"],
      access: ["Open"],
    },
  ];
  assert.throws(
    () =>
      buildOfficialRoutePath(
        paths,
        { lng: 0, lat: 0 },
        { lng: 0.005, lat: 0.005 }
      ),
    /do not connect/
  );
});

test("official route search uses a valid detour instead of an unsafe shortcut", () => {
  const paths = [
    {
      featureId: "lower",
      properties: {},
      coordinates: [[0, 0], [0.004, 0]] as Array<[number, number]>,
      names: ["Lower"],
      access: ["Open"],
    },
    {
      featureId: "upper",
      properties: {},
      coordinates: [[0.00427, 0], [0.01, 0]] as Array<[number, number]>,
      names: ["Upper"],
      access: ["Open"],
    },
    {
      featureId: "detour",
      properties: {},
      coordinates: [
        [0.004, 0],
        [0.004, 0.005],
        [0.00427, 0.005],
        [0.00427, 0],
      ] as Array<[number, number]>,
      names: ["Official Detour"],
      access: ["Open"],
    },
  ];
  const route = buildOfficialRoutePath(
    paths,
    { lng: 0, lat: 0 },
    { lng: 0.01, lat: 0 }
  );
  const review = reviewOfficialRouteGeometry(
    route.coordinates.map(([lng, lat]) => ({ lng, lat })),
    route.usedPaths,
    route.usedFeatureIds
  );

  assert.deepEqual(route.usedFeatureIds, ["detour", "lower", "upper"]);
  assert.ok(route.largestConnectionM < 0.01);
  assert.ok(review.coreMaxOffsetM < 0.01);
  assert.equal(review.coreCoveragePct, 100);
  assert.equal(review.sourceTopologyValid, true);
});

test("official review samples a short internal source gap", () => {
  const paths = [
    {
      featureId: "lower",
      properties: {},
      coordinates: [[0, 0], [0.001, 0]] as Array<[number, number]>,
      names: ["Lower"],
      access: ["Open"],
    },
    {
      featureId: "upper",
      properties: {},
      coordinates: [[0.001135, 0], [0.002135, 0]] as Array<[number, number]>,
      names: ["Upper"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: 0, lat: 0 },
      { lng: 0.0005, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0.001135, lat: 0 },
      { lng: 0.0016, lat: 0 },
      { lng: 0.002135, lat: 0 },
    ],
    paths,
    ["lower", "upper"]
  );

  assert.ok(review.coreMaxOffsetM > 7);
  assert.ok(review.coreCoveragePct < 100);
  assert.equal(review.sourceTopologyValid, false);
});

test("official review caps a 5,000-point zigzag before sample growth", () => {
  const start = { lat: 0, lng: 0 };
  const end = { lat: 0, lng: 0.005 };
  const route = Array.from({ length: 5_000 }, (_, index) =>
    index % 2 === 0 ? start : end
  );
  const paths = [
    {
      featureId: "zigzag",
      properties: {},
      coordinates: [
        [start.lng, start.lat],
        [end.lng, end.lat],
      ] as Array<[number, number]>,
      names: [],
      access: [],
    },
  ];

  assert.throws(
    () => reviewOfficialRouteGeometry(route, paths, ["zigzag"]),
    /route core exceeds the 100000-sample review limit/
  );
});

test("official review rejects a turn at a non-noded source crossing", () => {
  const paths = [
    {
      featureId: "east-west",
      properties: {},
      coordinates: [[-0.001, 0], [0.001, 0]] as Array<[number, number]>,
      names: ["East-West"],
      access: ["Open"],
    },
    {
      featureId: "north-south",
      properties: {},
      coordinates: [[0, -0.001], [0, 0.001]] as Array<[number, number]>,
      names: ["North-South"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: -0.001, lat: 0 },
      { lng: -0.0005, lat: 0 },
      { lng: 0, lat: 0 },
      { lng: 0, lat: 0.0005 },
      { lng: 0, lat: 0.001 },
    ],
    paths,
    ["east-west", "north-south"]
  );

  assert.ok(review.coreMaxOffsetM < 0.01);
  assert.equal(review.coreCoveragePct, 100);
  assert.equal(review.sourceTopologyValid, false);
});

test("official review rejects a non-noded turn within one self-crossing path", () => {
  const paths = [
    {
      featureId: "self-crossing",
      properties: {},
      coordinates: [
        [-0.001, 0],
        [0.001, 0],
        [0.001, 0.002],
        [0, -0.001],
        [0, 0.001],
      ] as Array<[number, number]>,
      names: ["Self-Crossing Trail"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: -0.001, lat: 0 },
      { lng: -0.0005, lat: 0 },
      { lng: 0, lat: 0 },
      { lng: 0, lat: 0.0005 },
      { lng: 0, lat: 0.001 },
    ],
    paths,
    ["self-crossing"]
  );

  assert.ok(review.coreMaxOffsetM < 0.01);
  assert.equal(review.coreCoveragePct, 100);
  assert.equal(review.sourceTopologyValid, false);
});

test("official review preserves forward and reverse source traversal", () => {
  const paths = [
    {
      featureId: "ridge",
      properties: {},
      coordinates: [
        [0, 0],
        [0.001, 0],
        [0.002, 0.001],
      ] as Array<[number, number]>,
      names: ["Ridge Trail"],
      access: ["Open"],
    },
  ];
  const forward = [
    { lng: 0, lat: 0 },
    { lng: 0.0005, lat: 0 },
    { lng: 0.001, lat: 0 },
    { lng: 0.0015, lat: 0.0005 },
    { lng: 0.002, lat: 0.001 },
  ];
  const reverse = [...forward].reverse();

  assert.equal(
    reviewOfficialRouteGeometry(forward, paths, ["ridge"])
      .sourceTopologyValid,
    true
  );
  assert.equal(
    reviewOfficialRouteGeometry(reverse, paths, ["ridge"])
      .sourceTopologyValid,
    true
  );
});

test("official review measures a long endpoint cut across a U-shaped source", () => {
  const paths = [
    {
      featureId: "u-trail",
      properties: {},
      coordinates: [
        [0, 0],
        [0, 0.002],
        [0.002, 0.002],
        [0.002, 0],
      ] as Array<[number, number]>,
      names: ["U Trail"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: -0.00009, lat: 0 },
      { lng: 0.002, lat: 0 },
      { lng: 0.002, lat: 0.002 },
      { lng: 0, lat: 0.002 },
      { lng: 0, lat: 0 },
    ],
    paths,
    ["u-trail"]
  );

  assert.ok(review.startConnectorM > 200);
  assert.ok(review.startConnectorJoinOffsetM < 0.01);
  assert.equal(review.coreCoveragePct, 100);
  assert.ok(review.startConnectorM > 125);
});

test("official review checks both short legs of an internal summit connector", () => {
  const paths = [
    {
      featureId: "ridge",
      properties: {},
      coordinates: [[0, 0], [0.004, 0]] as Array<[number, number]>,
      names: ["Ridge Trail"],
      access: ["Open"],
    },
  ];
  const points = [
    { lng: 0, lat: 0 },
    { lng: 0.001, lat: 0 },
    { lng: 0.002, lat: 0.0005 },
    { lng: 0.003, lat: 0 },
    { lng: 0.004, lat: 0 },
  ];
  const review = reviewOfficialRouteGeometry(points, paths, ["ridge"], {
    internalConnectorSegmentIndexes: [1, 2],
  });

  assert.ok(review.internalConnectorMaxM > 120);
  assert.ok(review.internalConnectorMaxM < 125);
  assert.ok(review.internalConnectorJoinMaxOffsetM < 0.01);
  assert.equal(review.coreCoveragePct, 100);

  const tooLong = reviewOfficialRouteGeometry(
    points.map((point, index) =>
      index === 2 ? { ...point, lat: 0.0007 } : point
    ),
    paths,
    ["ridge"],
    { internalConnectorSegmentIndexes: [1, 2] }
  );
  assert.ok(tooLong.internalConnectorMaxM > 125);
});

test("official review does not count a cited trail that only crosses the route", () => {
  const paths = [
    {
      featureId: "followed",
      properties: {},
      coordinates: [[0, 0], [0.01, 0]] as Array<[number, number]>,
      names: ["Followed Trail"],
      access: ["Open"],
    },
    {
      featureId: "crossing",
      properties: {},
      coordinates: [[0.005, -0.005], [0.005, 0.005]] as Array<
        [number, number]
      >,
      names: ["Crossing Trail"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: 0, lat: 0 },
      { lng: 0.005, lat: 0 },
      { lng: 0.01, lat: 0 },
    ],
    paths,
    ["crossing", "followed"]
  );

  assert.deepEqual(review.usedFeatureIds, ["followed"]);
  assert.deepEqual(review.unusedFeatureIds, ["crossing"]);
});

test("official review counts substantial coverage of a short cited trail", () => {
  const paths = [
    {
      featureId: "short",
      properties: {},
      coordinates: [[0, 0], [0.0001, 0]] as Array<[number, number]>,
      names: ["Short Link"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: 0, lat: 0 },
      { lng: 0.0001, lat: 0 },
    ],
    paths,
    ["short"]
  );

  assert.deepEqual(review.usedFeatureIds, ["short"]);
  assert.deepEqual(review.unusedFeatureIds, []);
});

test("official route construction and review cross the antimeridian locally", () => {
  const paths = [
    {
      featureId: "dateline",
      properties: {},
      coordinates: [[179.998, 0], [-179.998, 0]] as Array<[number, number]>,
      names: ["Dateline Trail"],
      access: ["Open"],
    },
  ];
  const route = buildOfficialRoutePath(
    paths,
    { lng: 179.998, lat: 0 },
    { lng: -179.998, lat: 0 }
  );
  const review = reviewOfficialRouteGeometry(
    route.coordinates.map(([lng, lat]) => ({ lng, lat })),
    route.usedPaths,
    route.usedFeatureIds
  );

  assert.ok(route.distanceM > 440 && route.distanceM < 450);
  assert.equal(review.coreCoveragePct, 100);
  assert.ok(review.coreMaxOffsetM < 0.01);
  assert.deepEqual(review.usedFeatureIds, ["dateline"]);
  assert.deepEqual(review.unusedFeatureIds, []);
});

test("official review keeps a dateline source far from Greenwich", () => {
  const paths = [
    {
      featureId: "dateline",
      properties: {},
      coordinates: [[179.9, 0], [-179.9, 0]] as Array<[number, number]>,
      names: ["Dateline Trail"],
      access: ["Open"],
    },
  ];
  const review = reviewOfficialRouteGeometry(
    [
      { lng: -0.001, lat: 0 },
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
    ],
    paths,
    ["dateline"]
  );

  assert.equal(review.coreCoveragePct, 0);
  assert.ok(review.coreMaxOffsetM > 19_000_000);
  assert.deepEqual(review.usedFeatureIds, []);
  assert.deepEqual(review.unusedFeatureIds, ["dateline"]);
  assert.throws(
    () =>
      buildOfficialRoutePath(
        paths,
        { lng: -0.001, lat: 0 },
        { lng: 0.001, lat: 0 }
      ),
    /do not connect/
  );
});

test("official review accepts one joined lollipop retrace and rejects a plain loop", () => {
  const joinedLollipop = [
    { lng: 0, lat: 0 },
    { lng: 0.001, lat: 0 },
    { lng: 0.001, lat: 0.001 },
    { lng: 0.002, lat: 0.001 },
    { lng: 0.001, lat: 0 },
    { lng: 0, lat: 0 },
  ];
  assert.deepEqual(reviewLollipopRetrace(joinedLollipop), {
    valid: true,
    retracedPairs: 1,
  });
  assert.equal(
    reviewLollipopRetrace([
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0.001, lat: 0.001 },
      { lng: 0, lat: 0.001 },
      { lng: 0, lat: 0 },
    ]).valid,
    false
  );
  assert.equal(
    reviewLollipopRetrace([
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0.002, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0, lat: 0 },
    ]).valid,
    false,
    "a fully retraced out-and-back must not be labelled a lollipop"
  );
  assert.equal(
    reviewLollipopRetrace([
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0.001, lat: 0.001 },
      { lng: 0.002, lat: 0.001 },
      { lng: 0.002, lat: 0.002 },
      { lng: 0.003, lat: 0.001 },
      { lng: 0.002, lat: 0.001 },
      { lng: 0.001, lat: 0.001 },
      { lng: 0, lat: 0.001 },
      { lng: 0, lat: 0 },
    ]).valid,
    false,
    "an internal retrace must not turn two loops into a lollipop"
  );
  assert.equal(
    reviewLollipopRetrace([
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0.001, lat: 0.001 },
      { lng: 0.002, lat: 0.001 },
      { lng: 0.001, lat: 0 },
      { lng: 0.001, lat: -0.001 },
      { lng: 0.002, lat: -0.001 },
      { lng: 0.001, lat: 0 },
      { lng: 0, lat: 0 },
    ]).valid,
    false,
    "two loops on one retraced stem must not be labelled a lollipop"
  );
});

test("simple closed route review rejects a figure eight and accepts dateline loops", () => {
  assert.equal(
    isSimpleClosedRoute([
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0.001 },
      { lng: 0, lat: 0.001 },
      { lng: 0.001, lat: 0 },
      { lng: 0, lat: 0 },
    ]),
    false
  );
  assert.equal(
    isSimpleClosedRoute([
      { lng: 179.99, lat: 0 },
      { lng: -179.99, lat: 0 },
      { lng: -179.99, lat: 0.01 },
      { lng: 179.99, lat: 0.01 },
      { lng: 179.99, lat: 0 },
    ]),
    true
  );
});
