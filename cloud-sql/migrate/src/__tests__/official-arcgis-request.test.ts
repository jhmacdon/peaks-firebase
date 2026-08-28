import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  OFFICIAL_ARCGIS_REQUEST_TIMEOUT_MS,
  officialArcgisRequestOptions,
} from "../official-arcgis-request";

const MIGRATE_ROOT = join(__dirname, "../..");
const REPO_ROOT = join(MIGRATE_ROOT, "../..");
const NETWORK_SCRIPTS = [
  ".claude/skills/peaks-standard-route-backfill/scripts/find_official_trail_geometry.mts",
  ".claude/skills/peaks-standard-route-backfill/scripts/build_official_route_candidate.mts",
  ".claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts",
];

test("official ArcGIS requests use a shared 30 second abort signal", () => {
  const options = officialArcgisRequestOptions("Peaks test/1.0");
  assert.equal(OFFICIAL_ARCGIS_REQUEST_TIMEOUT_MS, 30_000);
  assert.equal(options.signal instanceof AbortSignal, true);
  assert.equal(options.signal?.aborted, false);
  assert.deepEqual(options.headers, { "user-agent": "Peaks test/1.0" });
});

test("every official ArcGIS network script uses the bounded request options", () => {
  for (const relativePath of NETWORK_SCRIPTS) {
    const script = readFileSync(join(REPO_ROOT, relativePath), "utf8");
    assert.match(script, /officialArcgisRequestOptions\(/, relativePath);
    assert.doesNotMatch(script, /fetch\([^;]+\{\s*headers:/s, relativePath);
  }
});

test("official discovery isolates service outages and bounds model-facing data", () => {
  const finder = readFileSync(join(REPO_ROOT, NETWORK_SCRIPTS[0]), "utf8");
  assert.match(finder, /Promise\.allSettled\(/);
  assert.match(finder, /every applicable official source failed/);
  assert.match(finder, /MAX_DISCOVERY_ROWS_PER_SOURCE = 200/);
  assert.match(finder, /resultRecordCount/);
  assert.match(finder, /FREE_TEXT_ACCESS_FIELD/);
  assert.match(finder, /MAX_DISPLAY_TEXT_LENGTH = 160/);
});
