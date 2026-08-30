import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = join(__dirname, "../../../..");

test("private reference geometry cannot steer an OSM candidate", () => {
  const builder = readFileSync(
    join(
      repositoryRoot,
      ".claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts"
    ),
    "utf8"
  );
  const comparison = readFileSync(
    join(
      repositoryRoot,
      ".claude/skills/peaks-standard-route-backfill/scripts/compare_route_reference.mts"
    ),
    "utf8"
  );

  assert.doesNotMatch(builder, /--reference/);
  assert.doesNotMatch(builder, /referenceMatcher|referencePenalty/);
  assert.match(comparison, /--reference/);
});
