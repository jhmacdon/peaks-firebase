import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260829_segment_path_spatial_index.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");
const matcher = readFileSync(
  resolve(__dirname, "../../../../web/src/lib/actions/segment-matcher.ts"),
  "utf8"
);

test("production adds the segment path GiST index without blocking writes", () => {
  assert.match(
    migration,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_path\s+ON segments USING GIST \(path\)/
  );
  assert.match(migration, /ANALYZE segments/);
});

test("fresh databases include the segment path GiST index", () => {
  assert.match(
    schema,
    /CREATE INDEX idx_segments_path\s+ON segments\s+USING GIST \(path\)/
  );
});

test("candidate matching keeps ST_DWithin on the indexed geography column", () => {
  assert.match(
    matcher,
    /ST_DWithin\(\s*s\.path,\s*ST_GeomFromText\(\$1, 4326\)::geography,\s*\$2\s*\)/
  );
  assert.doesNotMatch(matcher, /ST_DWithin\(\s*s\.path::geometry/);
});
