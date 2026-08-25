import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260825_scatter_creek_trailhead_location.sql"),
  "utf8"
);

function distanceMeters(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number }
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(second.lat - first.lat);
  const lngDelta = radians(second.lng - first.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(first.lat))
      * Math.cos(radians(second.lat))
      * Math.sin(lngDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

test("Scatter Creek correction updates the existing destination without creating a duplicate", () => {
  assert.match(migration, /UPDATE destinations[\s\S]*WHERE id = 'YYhaaSnzdNUdl8ZWWzDF'/);
  assert.doesNotMatch(migration, /INSERT INTO destinations/i);
  assert.match(migration, /ST_Z\(location::geometry\)/);
  assert.match(migration, /'osm', '12550193743'/);
});

test("Scatter Creek correction rejects missing or unexpected production catalog state", () => {
  assert.match(migration, /current_database\(\) NOT LIKE '%\\_test'/);
  assert.match(migration, /destination YYhaaSnzdNUdl8ZWWzDF is missing/);
  assert.match(migration, /refusing to replace an unknown Scatter Creek trailhead location/);
});

test("reviewed Scatter Creek point is inside the trailhead match radius of the route start", () => {
  const routeStart = { lat: 48.434929, lng: -120.519953 };
  const correctedTrailhead = { lat: 48.4351460, lng: -120.5198575 };
  const distance = distanceMeters(routeStart, correctedTrailhead);

  assert.ok(distance < 100, `expected less than 100 m, got ${distance.toFixed(1)} m`);
  assert.match(
    migration,
    /destination_match_radius\(ARRAY\['trailhead'\]::destination_feature\[\]\)/
  );
});
