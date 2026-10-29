import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { loadMontBlancPackage } from "../src/import-mont-blanc-glaciers";
import { applyGlacierManifest } from "../src/import-glacier-manifest";
import { backfillGlacierCrossings } from "../src/backfill-glacier-crossings";

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\/[^?]+_test(?:\?.*)?$/.test(url))
    throw new Error("Explicit localhost TEST_DATABASE_URL ending in _test required");
  const pool = new Pool({ connectionString: url, max: 1 });
  const pkg = loadMontBlancPackage(), ids = pkg.places.map(p => p.id);
  const parentIds = Object.fromEntries(Object.keys(pkg.parents!).map((k,i) => [k,`fixture-mont-blanc-parent-${i}`]));
  const route = "fixture-mont-blanc-route", session = "fixture-mont-blanc-session", user = "fixture-mont-blanc-user";
  const args = ["--apply", `--expected-manifest-sha256=${pkg.manifest_sha256}`, ...Object.entries(parentIds).map(([k,id]) => `--parent-id=${k}=${id}`)];
  process.env.GLACIER_DATABASE_URL = url;
  try {
    const version = (await pool.query("SELECT current_setting('server_version') AS postgres, postgis_lib_version() AS postgis")).rows[0];
    assert.match(version.postgres, /^15\./); assert.match(version.postgis, /^3\.6\./);
    for (const [key,p] of Object.entries(pkg.parents!)) await pool.query(`INSERT INTO destinations(id,name,search_name,owner,features,country_code,state_code,location)
      VALUES($1,$2,peaks_search_name($2),'peaks',$3::destination_feature[],$4,$5,ST_SetSRID(ST_MakePoint($6,$7,0),4326)::geography) ON CONFLICT(id) DO NOTHING`,
      [parentIds[key],p.name,`{${p.features.join(",")}}`,p.country_code,p.state_code,p.lng,p.lat]);
    await applyGlacierManifest(pkg, args);
    const state = async () => (await pool.query(`SELECT d.id,to_jsonb(d) AS destination,to_jsonb(gf) AS facts FROM destinations d
      JOIN destination_glacier_facts gf ON gf.destination_id=d.id WHERE d.id=ANY($1) ORDER BY d.id`,[ids])).rows;
    const before = await state(); assert.equal(before.length,91);
    await applyGlacierManifest(pkg,args); assert.deepEqual(await state(),before,"full import replay must leave every field and timestamp unchanged");
    const glacier = pkg.places.find(p => p.name === "Mer de Glace")!;
    // A synthetic line through an interior point with endpoints outside the
    // glacier exercises entry/exit spans, not only a fully contained segment.
    const path = (await pool.query(`WITH g AS (SELECT outline::geometry geom FROM destination_glacier_facts WHERE destination_id=$1),
      p AS (SELECT ST_PointOnSurface(geom) pt FROM g)
      SELECT ST_AsGeoJSON(ST_Force3D(ST_MakeLine(ST_Translate(pt,-0.03,0),ST_Translate(pt,0.03,0)))) path FROM p`,[glacier.id])).rows[0].path;
    await pool.query("INSERT INTO routes(id,name,owner,path) VALUES($1,'Mont Blanc synthetic crossing',$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)",[route,user,path]);
    await pool.query("INSERT INTO tracking_sessions(id,user_id,start_time,ended,path) VALUES($1,$2,to_timestamp(1700000000),true,ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)",[session,user,path]);
    const coordinates = JSON.parse(path).coordinates as number[][];
    // Dense, timed track points keep the canonical session processor's
    // plausibility checks meaningful along the same crossing.
    for (let i=0;i<=60;i++) {
      const t=i/60,x=coordinates[0][0]*(1-t)+coordinates[1][0]*t,y=coordinates[0][1];
      await pool.query("INSERT INTO tracking_points(session_id,time,segment_number,elevation,location) VALUES($1,$2,0,2000,ST_SetSRID(ST_MakePoint($3,$4,2000),4326)::geography)",[session,1700000000+i*120,x,y]);
    }
    await backfillGlacierCrossings(["--apply","--seed","--limit=5"]);
    await backfillGlacierCrossings(["--apply","--limit=5"]);
    const queues = (await pool.query(`SELECT (SELECT count(*)::int FROM route_glacier_rematch_queue) AS routes,
      (SELECT count(*)::int FROM session_rematch_queue WHERE reason LIKE 'glacier:%' OR reason LIKE 'glacier-rejection:%') AS sessions`)).rows[0];
    assert.deepEqual(queues,{routes:0,sessions:0});
    const routeSpans = (await pool.query("SELECT destination_id,crossed_distance_m FROM route_glacier_crossings WHERE route_id=$1",[route])).rows;
    const sessionSpans = (await pool.query("SELECT destination_id,crossed_distance_m FROM session_glacier_crossings WHERE session_id=$1",[session])).rows;
    assert.ok(routeSpans.some(r => r.destination_id===glacier.id && r.crossed_distance_m>0));
    assert.ok(sessionSpans.some(r => r.destination_id===glacier.id && r.crossed_distance_m>0));
    const verify = readFileSync("scripts/verify-mont-blanc.sql","utf8");
    const failures = (await pool.query(verify,[ids])).rows;
    if (failures.length) {
      const diagnostics = (await pool.query(`WITH g AS (SELECT d.id,d.name,d.boundary::geometry display,gf.outline::geometry original,
        (SELECT ST_UnaryUnion(ST_Collect(p.outline_part::geometry)) FROM glacier_outline_parts p WHERE p.destination_id=d.id) parts,
        (SELECT ST_UnaryUnion(ST_Collect(p.boundary_part::geometry)) FROM destination_boundary_parts p WHERE p.destination_id=d.id) display_parts,
        (SELECT geom FROM ST_Dump(gf.outline::geometry) ORDER BY ST_Area(geom::geography) DESC,path LIMIT 1) largest
        FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id WHERE d.id=ANY($1))
        SELECT id,name,ST_IsValid(original) valid,ST_Equals(original,parts) outline_equal,ST_Equals(display,display_parts) display_equal,ST_Equals(display,largest) largest_equal,
          ST_Area(ST_SymDifference(ST_Transform(original,32632),ST_Transform(parts,32632))) outline_difference_m2,
          ST_HausdorffDistance(ST_Transform(original,32632),ST_Transform(parts,32632)) outline_hausdorff_m,
          ST_Area(ST_SymDifference(ST_Transform(display,32632),ST_Transform(display_parts,32632))) display_difference_m2,
          ST_HausdorffDistance(ST_Transform(display,32632),ST_Transform(display_parts,32632)) display_hausdorff_m,
          ST_Area(ST_SymDifference(ST_Transform(display,32632),ST_Transform(largest,32632))) largest_difference_m2,
          ST_HausdorffDistance(ST_Transform(display,32632),ST_Transform(largest,32632)) largest_hausdorff_m FROM g`,[ids])).rows;
      writeFileSync(".cache/mont-blanc/geometry-diagnostics.json",JSON.stringify(diagnostics,null,2)+"\n");
    }
    assert.deepEqual(failures,[],"verify SQL must return no rows");
    const result = { ...version, manifest_sha256:pkg.manifest_sha256, imported:91, replay:"unchanged", queues,
      route_spans:routeSpans.length, session_spans:sessionSpans.length, verify_rows:failures.length };
    writeFileSync(".cache/mont-blanc/db-verification.json",JSON.stringify(result,null,2)+"\n");
    console.log(JSON.stringify(result));
  } finally {
    await pool.query("DELETE FROM tracking_sessions WHERE id=$1",[session]);
    await pool.query("DELETE FROM routes WHERE id=$1",[route]);
    await pool.query("DELETE FROM destinations WHERE id=ANY($1)",[ids]);
    await pool.query("DELETE FROM destinations WHERE id=ANY($1)",[Object.values(parentIds)]);
    await pool.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
