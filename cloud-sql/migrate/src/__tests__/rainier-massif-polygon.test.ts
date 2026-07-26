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
  const matches = [...sql.matchAll(/POLYGON\(\((.*?)\)\)/gs)];
  assert.equal(
    matches.length,
    1,
    `migration must contain exactly one POLYGON((...)) literal, found ${matches.length}`
  );
  return matches[0][1]
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

/**
 * Metres from a point to the nearest ring edge. The ring spans ~25 km, so a
 * local flat projection — degrees to metres, longitude scaled by cos(lat) — is
 * accurate to well under a metre here, and the assertions below only need tens
 * of metres of headroom.
 */
const M_PER_DEG = 111_320;
const RING_LAT = 46.87;
const LNG_SCALE = Math.cos((RING_LAT * Math.PI) / 180);

function project(p: Point): { x: number; y: number } {
  return { x: p.lng * LNG_SCALE * M_PER_DEG, y: p.lat * M_PER_DEG };
}

function metresToRing(ring: Point[], point: Point): number {
  const p = project(point);
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = project(ring[i]);
    const b = project(ring[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const raw = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const t = Math.max(0, Math.min(1, raw));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
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
  ["Mowich Lake", { lat: 46.933, lng: -121.864 }],
  ["White River Campground", { lat: 46.901, lng: -121.642 }],
];

/** How far every contained landmark must sit from the boundary, in metres. */
const MIN_MARGIN_M = 100;

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

test("the massif contains the summit and every named landmark on the mountain", () => {
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
 * A landmark on the boundary is neither in nor out — ray casting says
 * "outside", PostGIS `ST_Covers` says "inside", and floating point decides
 * which. Early drafts shipped Sunrise, Longmire, Mowich Lake, and White River
 * Campground as ring vertices; all four are now pushed down-valley. Checking
 * for vertex coincidence is not enough, because a landmark can sit on an edge
 * between two vertices, so measure the real distance to the boundary instead.
 */
test("every contained landmark clears the ring by a real margin", () => {
  const ring = loadRing();
  for (const [name, point] of INSIDE) {
    const metres = metresToRing(ring, point);
    assert.ok(
      metres > MIN_MARGIN_M,
      `${name} sits ${metres.toFixed(0)} m from the ring — containment needs > ${MIN_MARGIN_M} m of margin`
    );
  }
});
