import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260827_triple_crown_route_sections.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");

for (const [name, sql] of [["migration", migration], ["schema", schema]] as const) {
  test(`${name} stores ordered route sections in the coverage fraction domain`, () => {
    assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? route_sections/);
    assert.match(sql, /REFERENCES routes\(id\) ON DELETE CASCADE/);
    assert.match(sql, /UNIQUE \(route_id, ordinal\)/);
    assert.match(sql, /CHECK \(end_fraction > start_fraction\)/);
    assert.match(sql, /GRANT SELECT ON route_sections TO "peaks-api"/);
  });
}
