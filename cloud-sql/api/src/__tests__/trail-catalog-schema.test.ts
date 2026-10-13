import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { routeDoneCoverageSql } from "../route-coverage";

const migration = readFileSync(resolve(__dirname, "../../../migrations/20261012_first_class_trails.sql"), "utf8");
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");

function functionDefinition(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `${name} has a full body`);
  return source.slice(start, end + 4);
}

test("fresh schema and migration install the same trail functions", () => {
  for (const name of [
    "peaks_normalize_search_name", "peaks_search_names_text", "peaks_route_trip_metrics", "peaks_route_difficulty",
    "peaks_route_est_moving_seconds", "materialize_peaks_route_catalog",
    "refresh_peaks_route_catalog_stops", "refresh_peaks_route_catalog_destination",
    "peaks_refresh_route_popularity",
  ]) {
    assert.equal(functionDefinition(schema, name), functionDefinition(migration, name), name);
  }
});

test("route popularity uses the common done-coverage rule", () => {
  assert.ok(functionDefinition(migration, "peaks_refresh_route_popularity").includes(routeDoneCoverageSql("sr")));
});
