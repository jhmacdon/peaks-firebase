// Lake outlines reach 475k points. The API serves the simplified copy in
// destinations.boundary_display when there is one
// (migrations/20261009_lake_outline_paths.sql); a whole outline was an
// estimated 15-20 MB of GeoJSON per lake per response.

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const routesDir = join(__dirname, "..", "routes");

test("no route serves a whole destination boundary as GeoJSON", () => {
  for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(routesDir, file), "utf8");
    assert.doesNotMatch(
      text,
      /ST_AsGeoJSON\(d\.boundary\b/,
      `${file}: serve COALESCE(d.boundary_display, d.boundary) instead`
    );
  }
});

test("destination and session detail serve the display outline", () => {
  for (const file of ["destinations.ts", "sessions.ts"]) {
    const text = readFileSync(join(routesDir, file), "utf8");
    assert.match(text, /ST_AsGeoJSON\(COALESCE\(d\.boundary_display, d\.boundary\), 6\)/, file);
  }
});
