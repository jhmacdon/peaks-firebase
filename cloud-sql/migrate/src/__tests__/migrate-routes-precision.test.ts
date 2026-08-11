import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("legacy 2D polylines never create or replace a 3D route path", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../migrate-routes.ts"), "utf8");

  assert.match(source, /const path: null = null/);
  assert.match(source, /path = routes\.path/);
  assert.match(source, /elevation_string = COALESCE\(routes\.elevation_string, EXCLUDED\.elevation_string\)/);
  assert.doesNotMatch(source, /LINESTRING Z/);
  assert.doesNotMatch(source, /ST_GeogFromText\(\$3\)/);
  assert.doesNotMatch(source, /COALESCE\(EXCLUDED\.path, routes\.path\)/);
});
