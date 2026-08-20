import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  buildAdjacency,
  clusterEndpoints,
  metresBetween,
  metresBetweenSql,
  type Endpoint,
} from "../roads/topology";

test("distance is right to within a metre over a few hundred metres", () => {
  // One thousandth of a degree of latitude is 111.3 m everywhere.
  assert.ok(Math.abs(metresBetween({ lon: -105, lat: 40 }, { lon: -105, lat: 40.001 }) - 111.3) < 1);
  // The same step in longitude at 40 N is 111.3 * cos(40) = 85.3 m.
  assert.ok(Math.abs(metresBetween({ lon: -105, lat: 40 }, { lon: -104.999, lat: 40 }) - 85.3) < 1);
  assert.equal(metresBetween({ lon: -105, lat: 40 }, { lon: -105, lat: 40 }), 0);
});

test("endpoints closer than the tolerance become one node", () => {
  const points: Endpoint[] = [
    { lon: -105.0, lat: 40.0 },
    { lon: -105.00001, lat: 40.00001 }, // about 1.2 m away
  ];
  const result = clusterEndpoints(points, 10);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodeIdByEndpoint[0], result.nodeIdByEndpoint[1]);
  assert.equal(result.nodes[0]!.endpointCount, 2);
});

test("endpoints further apart than the tolerance stay separate", () => {
  const points: Endpoint[] = [
    { lon: -105.0, lat: 40.0 },
    { lon: -105.0, lat: 40.001 }, // 111 m away
  ];
  const result = clusterEndpoints(points, 10);
  assert.equal(result.nodes.length, 2);
  assert.notEqual(result.nodeIdByEndpoint[0], result.nodeIdByEndpoint[1]);
});

test("a pair straddling a grid boundary still merges", () => {
  // Two points a metre apart but on opposite sides of a cell edge: the search
  // has to look at neighbouring cells, not just the point's own.
  const tolerance = 10;
  const cell = tolerance / 111_320;
  const lat = Math.ceil(40 / cell) * cell;
  const points: Endpoint[] = [
    { lon: -105, lat: lat - 0.0000045 },
    { lon: -105, lat: lat + 0.0000045 },
  ];
  const result = clusterEndpoints(points, tolerance);
  assert.equal(result.nodes.length, 1);
});

test("merging is transitive along a chain", () => {
  const points: Endpoint[] = [
    { lon: -105.0, lat: 40.0 },
    { lon: -105.0, lat: 40.00005 }, // 5.6 m from the first
    { lon: -105.0, lat: 40.0001 }, // 5.6 m from the second, 11 m from the first
  ];
  const result = clusterEndpoints(points, 10);
  assert.equal(result.nodes.length, 1);
});

test("a node sits at the mean of the endpoints it joins", () => {
  const points: Endpoint[] = [
    { lon: -105.0, lat: 40.0 },
    { lon: -105.00002, lat: 40.00002 },
  ];
  const result = clusterEndpoints(points, 10);
  assert.ok(Math.abs(result.nodes[0]!.lon - -105.00001) < 1e-9);
  assert.ok(Math.abs(result.nodes[0]!.lat - 40.00001) < 1e-9);
});

test("clustering works at high latitude, where a degree of longitude is short", () => {
  // 0.0002 degrees of longitude at 61 N is about 10.8 m — outside a 10 m
  // tolerance. A grid laid out in degrees rather than metres would merge them.
  const points: Endpoint[] = [
    { lon: -149.0, lat: 61.0 },
    { lon: -149.0002, lat: 61.0 },
  ];
  const result = clusterEndpoints(points, 10);
  assert.equal(result.nodes.length, 2);
  const closer = clusterEndpoints(
    [
      { lon: -149.0, lat: 61.0 },
      { lon: -149.00005, lat: 61.0 },
    ],
    10,
  );
  assert.equal(closer.nodes.length, 1);
});

test("an empty input gives an empty graph", () => {
  const result = clusterEndpoints([], 10);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.nodeIdByEndpoint.length, 0);
});

test("a tolerance of zero or less is refused", () => {
  assert.throws(() => clusterEndpoints([{ lon: 0, lat: 0 }], 0), /tolerance/);
});

test("adjacency lists every edge at both of its ends", () => {
  const adjacency = buildAdjacency([
    { edgeId: "a", fromNode: 1, toNode: 2 },
    { edgeId: "b", fromNode: 2, toNode: 3 },
  ]);
  assert.deepEqual(adjacency.get(1)!.map((e) => e.edgeId), ["a"]);
  assert.deepEqual(adjacency.get(2)!.map((e) => e.edgeId), ["a", "b"]);
  assert.deepEqual(adjacency.get(3)!.map((e) => e.edgeId), ["b"]);
});

test("a closed loop is listed once, so a walk cannot count it twice", () => {
  const adjacency = buildAdjacency([{ edgeId: "loop", fromNode: 7, toNode: 7 }]);
  assert.equal(adjacency.get(7)!.length, 1);
});

test("the SQL distance agrees with the TypeScript one", async () => {
  // Splitting the road graph measures 25 million vertices in the database, far
  // more than can come into JavaScript, so the same formula exists twice. If
  // they ever drift, the split tolerance stops meaning what the clustering
  // tolerance means. No spatial extension here: it is plain arithmetic.
  const pairs: [Endpoint, Endpoint][] = [
    [{ lon: -105, lat: 40 }, { lon: -105, lat: 40.001 }],
    [{ lon: -105, lat: 40 }, { lon: -104.999, lat: 40 }],
    [{ lon: -149.5, lat: 61.2 }, { lon: -149.5002, lat: 61.2001 }],
    [{ lon: -66.1, lat: 18.3 }, { lon: -66.10005, lat: 18.29995 }],
    [{ lon: -121.4899, lat: 46.18 }, { lon: -121.4899, lat: 46.18 }],
  ];
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    for (const [a, b] of pairs) {
      const sql = metresBetweenSql(String(a.lon), String(a.lat), String(b.lon), String(b.lat));
      const result = await connection.runAndReadAll(`SELECT ${sql} AS d`);
      const fromSql = Number((result.getRowObjectsJS()[0] as { d: unknown }).d);
      const fromTs = metresBetween(a, b);
      assert.ok(
        Math.abs(fromSql - fromTs) < 1e-9,
        `SQL ${fromSql} vs TypeScript ${fromTs} for ${JSON.stringify([a, b])}`,
      );
    }
  } finally {
    connection.closeSync();
  }
});
