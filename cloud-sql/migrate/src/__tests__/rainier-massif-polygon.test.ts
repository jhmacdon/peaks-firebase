/**
 * DB-free guard on the curated Rainier massif ring. Parses the WKT straight out
 * of the migration file so the test and the shipped data can never drift, then
 * runs plain ray-casting containment on the named fixtures the iOS attribution
 * engine is specified against.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MIGRATION_PATH = join(
  __dirname,
  "../../../migrations/20260725_rainier_massif_boundary.sql"
);

type Point = { lng: number; lat: number };

function loadRing(): Point[] {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const match = sql.match(/POLYGON\(\((.*?)\)\)/s);
  assert.ok(match, "migration must contain a POLYGON((...)) literal");
  return match![1]
    .split(",")
    .map((pair) => pair.trim().split(/\s+/))
    .map(([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) }));
}

function contains(ring: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const x = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < x) inside = !inside;
  }
  return inside;
}

/** Segment-intersection test used to prove the ring is simple. */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) =>
    (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Fixtures the ring must contain, and the ones it must keep out. */
const INSIDE: Array<[string, Point]> = [
  ["Columbia Crest", { lat: 46.8523, lng: -121.7603 }],
  ["Camp Muir", { lat: 46.836, lng: -121.731 }],
  ["Paradise", { lat: 46.786, lng: -121.7354 }],
  ["Sunrise", { lat: 46.9145, lng: -121.643 }],
  ["Longmire", { lat: 46.75, lng: -121.813 }],
];

const OUTSIDE: Array<[string, Point]> = [
  ["Crystal Peak", { lat: 46.9147, lng: -121.5379 }],
  ["Crystal Peak (spec fixture)", { lat: 46.905, lng: -121.538 }],
  ["Mount Adams", { lat: 46.2024, lng: -121.4909 }],
  ["Seattle", { lat: 47.6062, lng: -122.3321 }],
];

test("the ring is closed and has at least 12 vertices", () => {
  const ring = loadRing();
  assert.ok(ring.length >= 13, `expected >= 13 points (12 + closing), got ${ring.length}`);
  assert.deepEqual(ring[0], ring[ring.length - 1], "ring must close on its first vertex");
});

test("the ring is simple — no self-intersections", () => {
  const ring = loadRing().slice(0, -1);
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue; // adjacent through the closure
      assert.equal(
        segmentsCross(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length]),
        false,
        `edges ${i} and ${j} cross`
      );
    }
  }
});

test("the massif contains the summit, Camp Muir, Paradise, Sunrise, Longmire", () => {
  const ring = loadRing();
  for (const [name, point] of INSIDE) {
    assert.ok(contains(ring, point), name);
  }
});

test("the massif excludes Crystal Peak and the wider Cascades", () => {
  const ring = loadRing();
  for (const [name, point] of OUTSIDE) {
    assert.equal(contains(ring, point), false, name);
  }
});

/**
 * A landmark placed exactly on a vertex is neither in nor out — ray casting
 * says "outside", PostGIS `ST_Covers` says "inside", and floating point decides
 * which. The seed ring shipped Sunrise and Longmire as vertices; both are now
 * pushed down-valley so the landmarks sit strictly inside. Keep it that way.
 */
test("no contained landmark sits on the ring itself", () => {
  const ring = loadRing();
  for (const [name, point] of INSIDE) {
    for (const vertex of ring) {
      assert.ok(
        Math.abs(vertex.lng - point.lng) > 1e-6 || Math.abs(vertex.lat - point.lat) > 1e-6,
        `${name} is a ring vertex — containment is undefined on the boundary`
      );
    }
  }
});
