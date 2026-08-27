import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260827_route_area_long_lines.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");

for (const [name, sql] of [["migration", migration], ["schema", schema]] as const) {
  test(`${name} subdivides long routes before exact area intersections`, () => {
    assert.match(sql, /ST_Subdivide\(r\.geom, 512\) AS route_part\(geom\)/);
    assert.match(sql, /part\.boundary_part && route_part\.geom/);
    assert.match(sql, /ST_Intersects\(part\.boundary_part, route_part\.geom\)/);
  });
}

test("the migration preserves exact relation and replacement rules", () => {
  assert.match(migration, /DELETE FROM route_areas/);
  assert.match(migration, /source = 'postgis'/);
  assert.match(migration, /ST_Covers\(a\.boundary, r\.geom\)/);
  assert.match(migration, /ON CONFLICT \(route_id, area_id\) DO NOTHING/);
});
