import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("area pages never expand or simplify authoritative boundaries at request time", () => {
  const source = readFileSync(
    join(fileURLToPath(new URL(".", import.meta.url)), "actions", "areas.ts"),
    "utf8"
  );

  // to_jsonb(a) expands the whole areas row, including the full PAD-US
  // boundary, once for every field access. This query repeatedly exhausted
  // the f1-micro's memory and forced Postgres recovery.
  assert.doesNotMatch(source, /to_jsonb\(a\)/);
  assert.doesNotMatch(source, /ST_SimplifyPreserveTopology/);
  assert.match(source, /ST_AsGeoJSON\(a\.boundary_display, 6\)/);
});

test("area personalization marks only reached destinations from the verified user", () => {
  const source = readFileSync(
    join(fileURLToPath(new URL(".", import.meta.url)), "actions", "areas.ts"),
    "utf8"
  );

  assert.match(source, /sd\.relation = 'reached'/);
  assert.match(source, /s\.user_id = \$2/);
  assert.match(source, /count\(DISTINCT sd\.session_id\)::int AS session_count/);
  assert.match(source, /d\.owner = 'peaks'/);
});

test("area detail loads reviewed destination photos for its visual roster", () => {
  const source = readFileSync(
    join(fileURLToPath(new URL(".", import.meta.url)), "actions", "areas.ts"),
    "utf8"
  );

  assert.match(source, /d\.hero_image, d\.hero_image_focal_x, d\.hero_image_focal_y/);
  assert.match(source, /d\.hero_image_attribution, d\.hero_image_attribution_url/);
  assert.match(source, /LIMIT 200/);
});
