import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const migration = readFileSync(join(__dirname,
  "../../../migrations/20261013_trail_catalog_publish_integrity.sql"), "utf8");
const osm = (ids: number[], more: Record<string, unknown> = {}) => ({
  source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/relation/123",
  license_name: "Open Data Commons Open Database License (ODbL) 1.0",
  license_url: "https://opendatacommons.org/licenses/odbl/1-0/", attribution: "© OpenStreetMap contributors",
  retrieved_at: "2026-10-12T00:00:00Z", contains_osm_geometry: true,
  osm_way_ids: ids, osm_way_urls: ids.map(id => `https://www.openstreetmap.org/way/${id}`), ...more,
});
const line = (coordinates: number[][]) => `SRID=4326;LINESTRING Z (${coordinates.map(point => point.join(" ")).join(",")})`;
const path = [[0, 0, 0], [0.001, 0, 20], [0.002, 0, 50], [0.003, 0, 60], [0.004, 0, 100]];

test("kind-aware migration preserves canonical rights, review, elevation, and cover gates", () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION (?:is_valid_route_provenance|enforce_peaks_route_cover_activation|activate_standard_route_factory|guard_standard_route)/);
  assert.doesNotMatch(migration, /UPDATE routes|ALTER TABLE routes|DISABLE TRIGGER/);
  assert.match(migration, /is_valid_route_provenance\(segment_provenance\)/);
  assert.match(migration, /route_elevation_profile_has_real_range\(c.path\)/);
  assert.match(migration, /assembly_checks.route_points = assembly_checks.matching_points/);
  assert.match(migration, /route_segments_cover_provenance\(c.id\)/);
  assert.match(migration, /Cost:.*~\$0\/month/);
});

test("source coverage and kind contact pass only independently valid, exactly assembled routes", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set",
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/, "publication fixtures require a disposable *_test database");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  const prefix = `catalog-gate-${process.pid}-${Date.now()}`;
  const id = (label: string) => `${prefix}-${label}`;
  const pass = async (route: string, required: string | null = null) => (await client.query(
    "SELECT peaks_route_passes_publish_integrity($1,$2,'pending') AS passes", [id(route), required && id(required)],
  )).rows[0].passes;
  const contact = async (route: string) => (await client.query(
    "SELECT peaks_route_kind_passes_contact($1) AS passes", [id(route)],
  )).rows[0].passes;
  const compatible = async (segment: unknown, route: unknown) => (await client.query(
    "SELECT route_segment_provenance_compatible($1::jsonb,$2::jsonb) AS passes", [JSON.stringify(segment), JSON.stringify(route)],
  )).rows[0].passes;
  const makeRoute = async (label: string, kind: string | null, shape: string,
    objective: string | null, links: string[], coordinates = path) => {
    const wkt = line(coordinates);
    await client.query(`INSERT INTO routes
      (id,name,owner,status,kind,shape,objective_destination_id,trailhead_destination_id,path,provenance,distance,gain,gain_loss)
      SELECT $1,$1,'peaks','pending',$2,$3::route_shape,$4,$5,ST_GeogFromText($6),$7::jsonb,
        ST_Length(ST_GeogFromText($6)),stats.gain,stats.loss FROM route_elevation_stats(ST_GeogFromText($6)) stats`,
    [id(label), kind, shape, objective && id(objective), kind && id("start"), wkt, JSON.stringify(osm([101, 202]))]);
    for (const [ordinal, destination] of links.entries()) await client.query(
      "INSERT INTO route_destinations (route_id,destination_id,ordinal) VALUES ($1,$2,$3)", [id(label), id(destination), ordinal]);
    for (const [ordinal, points] of [coordinates.slice(0, 3), coordinates.slice(2)].entries()) {
      const source = osm([ordinal ? 202 : 101], {
        source_url: `https://www.openstreetmap.org/way/${ordinal ? 202 : 101}`,
        retrieved_at: "2026-10-11T00:00:00Z",
      });
      await client.query(`INSERT INTO segments (id,path,distance,gain,gain_loss,provenance)
        SELECT $1,ST_GeogFromText($2),ST_Length(ST_GeogFromText($2)),stats.gain,stats.loss,$3::jsonb
        FROM route_elevation_stats(ST_GeogFromText($2)) stats`,
      [id(`${label}-segment-${ordinal}`), line(points), JSON.stringify(source)]);
      await client.query("INSERT INTO route_segments (route_id,segment_id,ordinal) VALUES ($1,$2,$3)",
        [id(label), id(`${label}-segment-${ordinal}`), ordinal]);
    }
  };
  const isolatedChange = async (change: () => Promise<void>) => {
    await client.query("SAVEPOINT variation");
    try { await change(); } finally { await client.query("ROLLBACK TO SAVEPOINT variation"); }
  };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query(`INSERT INTO destinations (id,name,search_name,features,location) VALUES
      ($1,'Start','start',ARRAY['trailhead']::destination_feature[],ST_GeogFromText('POINT Z (0 0 0)')),
      ($2,'End','end',ARRAY['trailhead']::destination_feature[],ST_GeogFromText('POINT Z (0.004 0 100)')),
      ($3,'Peak','peak',ARRAY['summit']::destination_feature[],ST_GeogFromText('POINT Z (0.004 0 100)')),
      ($4,'Named Lake','named lake',ARRAY['lake']::destination_feature[],ST_GeogFromText('POINT Z (0.02 0 100)')),
      ($5,'Middle Lake','middle lake',ARRAY['lake']::destination_feature[],ST_GeogFromText('POINT Z (0.002 0 50)'))`,
    [id("start"), id("end"), id("peak"), id("lake"), id("middle")]);
    await client.query(`UPDATE destinations SET boundary=ST_GeogFromText(
      'POLYGON ((0.0038 -0.001,0.0042 -0.001,0.0042 0.001,0.0038 0.001,0.0038 -0.001))') WHERE id=$1`, [id("lake")]);

    assert.equal(await compatible(osm([101], { retrieved_at: "2026-10-10T00:00:00Z", source_url: "https://www.openstreetmap.org/way/101" }), osm([101, 202])), true);
    assert.equal(await compatible(osm([303]), osm([101, 202])), false);
    assert.equal(await compatible(osm([101], { license_name: "Unknown rights" }), osm([101])), false);
    assert.equal(await compatible(osm([101], { elevation_source: "terrain-a", elevation_profile: "terrain" }),
      osm([101], { elevation_source: "terrain-b", elevation_profile: "terrain" })), false);
    const official = { source_kind: "agency", source_url: "https://example.test/feature/1", license_name: "Public Domain",
      license_url: "https://example.test/license", attribution: "Agency", retrieved_at: "2026-10-12T00:00:00Z",
      contains_osm_geometry: false, osm_way_ids: [], osm_way_urls: [] };
    assert.equal(await compatible(official, { ...official, retrieved_at: "2026-10-11T00:00:00Z" }), true);
    assert.equal(await compatible(official, { ...official, source_url: "https://example.test/feature/2" }), false);
    assert.equal(await compatible(official, osm([101])), false, "mixed sources require a separate source ledger");
    assert.equal(await compatible(null, osm([101])), false);

    await makeRoute("destination", "destination", "out_and_back", "lake", ["start", "lake"]);
    assert.equal(await pass("destination", "lake"), true, "lake shore wins over a distant representative point");
    await isolatedChange(async () => {
      // A sub-decimetre joint must use the prior end, matching publish assembly.
      await client.query(`UPDATE segments SET path=ST_SetPoint(path::geometry,0,
        ST_SetSRID(ST_MakePoint(0.0020004,0,50),4326))::geography WHERE id=$1`, [id("destination-segment-1")]);
      await client.query(`UPDATE routes SET gain=99999,gain_loss=99999,elevation_string='stale' WHERE id=$1`, [id("destination")]);
      await client.query("SELECT rebuild_route_path($1)", [id("destination")]);
      assert.equal(await pass("destination", "lake"), true,
        "rebuild must refresh elevation, gain, loss and sub-decimetre joints so publish integrity passes");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE destinations SET boundary=NULL WHERE id=$1", [id("lake")]);
      assert.equal(await pass("destination"), false, "a missing boundary must fall back to the actual distant point");
      await client.query("UPDATE destinations SET location=ST_GeogFromText('POINT Z (0.004 0 100)') WHERE id=$1", [id("lake")]);
      assert.equal(await pass("destination"), true);
      await client.query(`UPDATE destinations SET boundary=ST_GeogFromText(
        'POLYGON ((0.02 -0.001,0.021 -0.001,0.021 0.001,0.02 0.001,0.02 -0.001))') WHERE id=$1`, [id("lake")]);
      assert.equal(await pass("destination"), false, "an endpoint near only the point cannot bypass an existing outline");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE routes SET provenance=$2::jsonb WHERE id=$1", [id("destination"), JSON.stringify(osm([101, 202, 303]))]);
      assert.equal(await pass("destination"), false, "every cited route way must occur on a contributing segment");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE segments SET provenance=$2::jsonb WHERE id=$1", [id("destination-segment-0"), JSON.stringify(osm([303]))]);
      assert.equal(await pass("destination"), false, "segments cannot cite ways outside the route union");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE segments SET gain=gain+1 WHERE id=$1", [id("destination-segment-0")]);
      assert.equal(await pass("destination"), false, "per-segment elevation stats remain exact");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE routes SET path=ST_GeogFromText($2) WHERE id=$1", [id("destination"), line([...path.slice(0, 2), [0.002, 0, 51], ...path.slice(3)])]);
      assert.equal(await pass("destination"), false, "an independently rebuilt profile cannot bypass exact XYZ segment assembly");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE route_segments SET ordinal=ordinal+1 WHERE route_id=$1", [id("destination")]);
      assert.equal(await pass("destination"), false);
    });
    await isolatedChange(async () => {
      await client.query("UPDATE route_destinations SET ordinal=ordinal+1 WHERE route_id=$1", [id("destination")]);
      assert.equal(await pass("destination"), false);
    });
    await isolatedChange(async () => {
      await client.query("UPDATE destinations SET location=ST_GeogFromText('POINT Z (-0.002 0 0)') WHERE id=$1", [id("start")]);
      assert.equal(await pass("destination"), false, "all kinds retain the 125m start contact");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE routes SET status='active' WHERE id=$1", [id("destination")]);
      await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), /fully credited derived cover/);
    });

    await makeRoute("legacy", null, "out_and_back", null, ["start", "peak"]);
    await makeRoute("summit", "summit", "out_and_back", "peak", ["start", "peak"]);
    assert.equal(await pass("legacy", "peak"), true);
    assert.equal(await pass("summit", "peak"), true);
    await isolatedChange(async () => {
      await client.query("UPDATE destinations SET location=ST_GeogFromText('POINT Z (0.0041 0 100)') WHERE id=$1", [id("peak")]);
      assert.equal(await pass("legacy", "peak"), false);
      assert.equal(await pass("summit", "peak"), false, "5m summit contact is never widened to 250m");
    });

    await makeRoute("traverse", "traverse", "point_to_point", "middle", ["start", "middle", "end"]);
    assert.equal(await pass("traverse", "middle"), true, "a traverse may identify a natural objective along its path");
    await isolatedChange(async () => {
      await client.query("UPDATE routes SET objective_destination_id=$2 WHERE id=$1", [id("traverse"), id("end")]);
      assert.equal(await pass("traverse", "end"), true);
      await client.query("UPDATE destinations SET location=ST_GeogFromText('POINT Z (0.006 0 100)') WHERE id=$1", [id("end")]);
      assert.equal(await pass("traverse"), false, "traverse end trailhead retains 125m contact");
    });
    await isolatedChange(async () => {
      await client.query("UPDATE routes SET shape='out_and_back' WHERE id=$1", [id("traverse")]);
      assert.equal(await pass("traverse"), false);
    });
    const loop = [[0, 0, 0], [0.002, 0, 50], [0.004, 0, 100], [0.002, 0.001, 50], [0, 0, 0]];
    await makeRoute("loop", "loop", "loop", null, ["start"], loop);
    assert.equal(await pass("loop", "start"), true);
    await isolatedChange(async () => {
      await client.query("UPDATE routes SET path=ST_GeogFromText($2) WHERE id=$1", [id("loop"), line([...loop.slice(0, 4), [0.00002, 0, 0]])]);
      assert.equal(await contact("loop"), false, "an open source line cannot be labeled a closed loop");
    });
    await isolatedChange(async () => {
      const duplicate = line([[0, 0, 0], [0, 0, 0]]);
      await client.query(`INSERT INTO segments (id,path,gain,gain_loss,provenance)
        VALUES ($1,ST_GeogFromText($2),0,0,$3::jsonb)`, [id("zero-span"), duplicate, JSON.stringify(osm([303]))]);
      await client.query("UPDATE route_segments SET ordinal=ordinal+1 WHERE route_id=$1", [id("destination")]);
      await client.query("INSERT INTO route_segments (route_id,segment_id,ordinal) VALUES ($1,$2,0)", [id("destination"), id("zero-span")]);
      await client.query("UPDATE routes SET path=ST_GeogFromText($2),provenance=$3::jsonb WHERE id=$1",
        [id("destination"), line([path[0], ...path]), JSON.stringify(osm([101, 202, 303]))]);
      assert.equal(await pass("destination"), false, "zero-length segments cannot manufacture source coverage");
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
