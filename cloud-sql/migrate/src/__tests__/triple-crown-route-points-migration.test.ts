import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260827_triple_crown_route_points.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");
const importer = readFileSync(
  resolve(__dirname, "../import-triple-crown-trails.ts"),
  "utf8"
);

for (const [name, sql] of [["migration", migration], ["schema", schema]] as const) {
  test(`${name} scopes the indexed points to the three Triple Crown IDs`, () => {
    assert.match(sql, /CREATE TABLE (?:IF NOT EXISTS )?triple_crown_route_points/);
    assert.match(sql, /REFERENCES routes\(id\) ON DELETE CASCADE/);
    assert.match(sql, /PRIMARY KEY \(route_id, idx\)/);
    assert.match(sql, /USING GIST \(pt\)/);
    for (const id of ["triple-crown-pct", "triple-crown-at", "triple-crown-cdt"]) {
      assert.match(sql, new RegExp(id));
    }
  });
}

test("the migration has no global route trigger or all-route backfill", () => {
  assert.doesNotMatch(migration, /CREATE TRIGGER/);
  assert.doesNotMatch(migration, /SELECT id FROM routes/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.match(migration, /TO "peaks-api"/);
});

test("the guarded importer replaces and counts every indexed point", () => {
  assert.match(importer, /DELETE FROM triple_crown_route_points WHERE route_id = \$1/);
  assert.match(importer, /INSERT INTO triple_crown_route_points/);
  assert.match(importer, /ST_Distance\(pt::geography, prev_pt::geography, false\)/);
  assert.match(importer, /indexed\.rowCount !== plan\.serverPoints\.length/);
});
