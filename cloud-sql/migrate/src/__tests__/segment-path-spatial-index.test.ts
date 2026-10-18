import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
// Runtime imports preserve migrate's rootDir; these shared TS files run via tsx.
const { analyzeRouteSegmentsWithClient } = require("../../../../web/src/lib/segment-matcher-core");
const { pointsToLineStringZ } = require("../../../../web/src/lib/route-utils");
type TrackPoint = { lat: number; lng: number; ele: number; dist: number };

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260829_segment_path_spatial_index.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");
const matcher = readFileSync(
  resolve(__dirname, "../../../../web/src/lib/segment-matcher-core.ts"),
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

test("bounded exact scan uses the geography index envelope and preserves short directed spans", {
  skip: process.env.ROUTE_JOB_TEST_DATABASE_URL ? false : "disposable PostGIS database URL required",
}, async () => {
  const connectionString = process.env.ROUTE_JOB_TEST_DATABASE_URL!;
  assert.match(new URL(connectionString).pathname, /_test$/);
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const points: TrackPoint[] = Array.from({ length: 5 }, (_, index) =>
    ({ lat: 47 + index * 0.0001, lng: -121, ele: 100 + index, dist: 0 }));
  const automatic = { exactOnly: true, allowExistingSplits: false };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='10s'");
    // Shadow only this connection's segment table. No catalog rows are touched.
    await client.query(`CREATE TEMP TABLE segments (
      id text PRIMARY KEY, name text, distance double precision,
      path geography(LineStringZ,4326)
    ) ON COMMIT DROP`);
    await client.query("CREATE INDEX ON segments USING gist(path)");
    await client.query(`INSERT INTO segments(id,name,distance,path)
      VALUES('short','short',22,ST_GeomFromText($1,4326)::geography)`,
    [pointsToLineStringZ(points.slice(1,4))]);
    for (const reverse of [false,true]) {
      const input = reverse ? points.slice(1,4).reverse() : points.slice(1,4);
      const result = await analyzeRouteSegmentsWithClient(client,input,automatic);
      assert.equal(result.segments.length,1);
      assert.equal(result.segments[0].existingSegmentId,"short");
      assert.equal(result.segments[0].direction,reverse ? "reverse" : "forward");
    }
    const toleranceInput = points.slice(1,4).map(point=>({...point,lng:point.lng+1e-10}));
    assert.equal((await analyzeRouteSegmentsWithClient(client,toleranceInput,automatic)).segments[0].existingSegmentId,"short");
    assert.equal((await analyzeRouteSegmentsWithClient(client,points.slice(1,4),{
      ...automatic,excludeSegmentIds:["short"],
    })).segments[0].type,"new");
    await client.query("UPDATE segments SET path=ST_GeomFromText($1,4326)::geography WHERE id='short'",[pointsToLineStringZ(points)]);
    for (const input of [points.slice(1,4),points.slice(1,4).reverse()]) {
      await assert.rejects(analyzeRouteSegmentsWithClient(client,input,automatic),/existing_segment_split_requires_review:short/);
    }
    await client.query(`INSERT INTO segments(id,name,distance,path)
      SELECT 'overflow-'||n,'overflow',22,ST_GeomFromText($1,4326)::geography
      FROM generate_series(1,512) n`,[pointsToLineStringZ(points.slice(1,4))]);
    await assert.rejects(analyzeRouteSegmentsWithClient(client,points.slice(1,4),automatic),/exact_candidate_scan_limit_exceeded:512/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
