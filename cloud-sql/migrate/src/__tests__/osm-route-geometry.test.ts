import assert from "node:assert/strict";
import test from "node:test";

import {
  nearestOsmRouteSource,
  reviewOsmRouteGeometry,
  reviewOsmRouteTopology,
  type OsmRouteGraphSegment,
  type OsmRoutePoint,
  type OsmRouteSourceSegment,
} from "../osm-route-geometry";

function segments(
  wayId: number,
  points: readonly OsmRoutePoint[]
): OsmRouteSourceSegment[] {
  return points.slice(1).map((end, index) => ({
    wayId,
    start: points[index],
    end,
  }));
}

test("OSM review samples a U-shaped cut in the first core segment", () => {
  const source = segments(1, [
    { lng: 0, lat: 0 },
    { lng: 0, lat: 0.002 },
    { lng: 0.002, lat: 0.002 },
    { lng: 0.002, lat: 0 },
  ]);
  const route = [
    { lng: 0, lat: 0 },
    { lng: 0.002, lat: 0 },
    { lng: 0.002, lat: 0.002 },
    { lng: 0, lat: 0.002 },
    { lng: 0, lat: 0 },
  ];
  const review = reviewOsmRouteGeometry(route, source);
  const offsets = review.coreSamples.map(
    (point) => nearestOsmRouteSource(point, source).distance
  );

  assert.equal(review.coreStartIndex, 0);
  assert.equal(review.coreEndIndex, route.length - 1);
  assert.equal(review.startConnectorM, 0);
  assert.equal(review.endConnectorM, 0);
  assert.ok(Math.max(...offsets) > 100);
  assert.ok(
    review.coreSamples.some(
      (point) => point.lng > 0 && point.lng < 0.002 && point.lat === 0
    ),
    "the formerly skipped first segment must be sampled"
  );
});

test("OSM review measures connector length along the stored route", () => {
  const source = segments(7, [
    { lng: 0, lat: 0 },
    { lng: 0.01, lat: 0 },
  ]);
  const route = [
    { lng: 0, lat: 0.001 },
    { lng: 0.01, lat: 0 },
    { lng: 0.009, lat: 0 },
    { lng: 0.008, lat: 0 },
    { lng: 0.007, lat: 0 },
  ];
  const review = reviewOsmRouteGeometry(route, source);

  assert.ok(nearestOsmRouteSource(route[0], source).distance < 125);
  assert.ok(review.startConnectorM > 1_000);
  assert.ok(review.startConnectorJoinOffsetM < 0.01);
});

test("OSM review includes both ends and the midpoint of a short core segment", () => {
  const source = segments(4, [
    { lng: 0, lat: 0 },
    { lng: 0.00001, lat: 0 },
  ]);
  const review = reviewOsmRouteGeometry(
    [
      { lng: -0.0001, lat: 0 },
      { lng: 0, lat: 0 },
      { lng: 0.00001, lat: 0 },
      { lng: 0.00011, lat: 0 },
    ],
    source
  );

  assert.equal(review.coreSamples.length, 3);
  assert.ok(
    review.coreSamples.some(
      (point) => Math.abs(point.lng - 0.000005) < 1e-12
    )
  );
  assert.ok(review.startConnectorM > 11 && review.startConnectorM < 12);
  assert.ok(review.endConnectorM > 11 && review.endConnectorM < 12);
});

test("OSM topology accepts a turn only through a shared OSM node", () => {
  const source: OsmRouteGraphSegment[] = [
    {
      wayId: 10,
      startNodeId: 1,
      endNodeId: 2,
      start: { lng: -0.001, lat: 0 },
      end: { lng: 0, lat: 0 },
    },
    {
      wayId: 20,
      startNodeId: 2,
      endNodeId: 3,
      start: { lng: 0, lat: 0 },
      end: { lng: 0, lat: 0.001 },
    },
  ];
  const route = [
    { lng: -0.001, lat: 0 },
    { lng: -0.0005, lat: 0 },
    { lng: 0, lat: 0 },
    { lng: 0, lat: 0.0005 },
    { lng: 0, lat: 0.001 },
  ];

  assert.equal(reviewOsmRouteTopology(route, source).valid, true);

  const nonNodedCrossing: OsmRouteGraphSegment[] = [
    {
      wayId: 10,
      startNodeId: 1,
      endNodeId: 4,
      start: { lng: -0.001, lat: 0 },
      end: { lng: 0.001, lat: 0 },
    },
    {
      wayId: 20,
      startNodeId: 5,
      endNodeId: 3,
      start: { lng: 0, lat: -0.001 },
      end: { lng: 0, lat: 0.001 },
    },
  ];
  const geometricReview = reviewOsmRouteGeometry(route, nonNodedCrossing);
  assert.ok(
    geometricReview.coreSamples.every(
      (point) =>
        nearestOsmRouteSource(point, nonNodedCrossing).distance < 0.01
    ),
    "the old union-distance review cannot see the non-noded turn"
  );
  assert.equal(
    reviewOsmRouteTopology(route, nonNodedCrossing).valid,
    false
  );
});

test("OSM topology rejects a short gap whose samples stay within five meters", () => {
  const source: OsmRouteGraphSegment[] = [
    {
      wayId: 30,
      startNodeId: 10,
      endNodeId: 11,
      start: { lng: -0.001, lat: 0 },
      end: { lng: -0.00004, lat: 0 },
    },
    {
      wayId: 40,
      startNodeId: 12,
      endNodeId: 13,
      start: { lng: 0.00004, lat: 0 },
      end: { lng: 0.001, lat: 0 },
    },
  ];
  const route = [
    { lng: -0.001, lat: 0 },
    { lng: -0.00004, lat: 0 },
    { lng: 0.00004, lat: 0 },
    { lng: 0.0005, lat: 0 },
    { lng: 0.001, lat: 0 },
  ];
  const geometricReview = reviewOsmRouteGeometry(route, source);
  assert.ok(
    geometricReview.coreSamples.every(
      (point) => nearestOsmRouteSource(point, source).distance <= 5
    ),
    "the gap is deliberately short enough to pass the old distance threshold"
  );
  assert.equal(reviewOsmRouteTopology(route, source).valid, false);
});

test("OSM topology keeps one endpoint connector outside the source graph", () => {
  const source: OsmRouteGraphSegment[] = [
    {
      wayId: 50,
      startNodeId: 21,
      endNodeId: 22,
      start: { lng: 0, lat: 0 },
      end: { lng: 0.001, lat: 0 },
    },
    {
      wayId: 50,
      startNodeId: 22,
      endNodeId: 23,
      start: { lng: 0.001, lat: 0 },
      end: { lng: 0.002, lat: 0 },
    },
  ];
  const route = [
    { lng: -0.00002, lat: 0.00002 },
    { lng: 0, lat: 0 },
    { lng: 0.0005, lat: 0 },
    { lng: 0.001, lat: 0 },
    { lng: 0.002, lat: 0 },
  ];
  const review = reviewOsmRouteTopology(route, source);

  assert.equal(review.valid, true);
  assert.deepEqual(review.endpointConnectorSegmentIndexes, [0]);
  assert.ok(review.startConnectorM > 3 && review.startConnectorM < 4);
});
