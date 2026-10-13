import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOfficialArcgisQueryUrl } from "../official-route-geometry";
import { getPublishableArcgisTrailSource } from "../official-trail-sources";
import { buildCandidate } from "../trail-catalog/candidate-source";
import { sha256, stableJson } from "../trail-catalog/graph";
import { prepareElevation } from "../trail-catalog/sources";
import { claimCandidate, enqueueCandidate, type CandidateArtifact } from "../trail-catalog/jobs";
import { writePendingCandidate } from "../trail-catalog/pending";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../lib/terrarium-attribution";
import type { CatalogPlace, PilotCandidateInput } from "../trail-catalog/types";

const source = getPublishableArcgisTrailSource("usfs-nfs-trails");
const databaseUrl = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const sourceUrl = (ids: string[]) => buildOfficialArcgisQueryUrl(source.service, ids).toString();
const provenance = (ids: string[], extra: Record<string, unknown> = {}) => ({
  source_kind: "usfs-nfs-trails", source_url: sourceUrl(ids),
  license_name: source.license.name, license_url: source.license.url, attribution: source.license.attribution,
  retrieved_at: "2026-10-01T00:00:00Z", osm_way_ids: [], osm_way_urls: [], contains_osm_geometry: false,
  elevation_source: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)", elevation_profile: "terrain", ...extra,
});

const factoryUrl = process.env.ROUTE_JOB_FACTORY_TEST_DATABASE_URL;
test("USFS factory writes source-specific children, reuses exact spans, and rejects padded child credit", {
  skip: databaseUrl && factoryUrl ? false : "disposable operator/factory database URLs required",
}, async () => {
  const target = new URL(databaseUrl!);
  for (const value of [databaseUrl!, factoryUrl!]) {
    const url = new URL(value); assert.match(url.pathname, /_test$/);
    assert.equal(url.pathname, target.pathname); assert.equal(url.host, target.host);
  }
  const operator = new Pool({ connectionString: databaseUrl, max: 1 });
  const factory = new Pool({ connectionString: factoryUrl, max: 1 });
  const worker = await factory.connect();
  const prefix = `usfs-worker-${process.pid}-${Date.now()}`;
  const dir = mkdtempSync(join(tmpdir(), "peaks-usfs-worker-"));
  const routeIds: string[] = [], segmentIds: string[] = [], sourceKeys: string[] = [];
  const head: CatalogPlace = { id: `${prefix}-head`, name: "USFS Worker Trailhead", features: ["trailhead"], stateCode: "WA", countryCode: "US", lng: 0.7, lat: 0.7, boundary: null };
  const lake = (n: number): CatalogPlace => ({ ...head, id: `${prefix}-lake-${n}`, name: `USFS Worker Lake ${n}`, features: ["lake"], lng: 0.704 });
  const places = [head, lake(1), lake(2), lake(3)];
  const coordinates = [[0.7, 0.7], [0.701, 0.7], [0.702, 0.7], [0.703, 0.7], [0.704, 0.7]];
  const artifact = (n: number): CandidateArtifact => {
    const payload = { type: "FeatureCollection", features: ["lower", "upper"].map((id, i) => ({
      type: "Feature", properties: { globalid: id, trail_name: "Shared USFS Trail", trail_no: `10${i}`, attributesubset: "TrailNFS_MGMT", allowed_terra_use: "1" },
      geometry: { type: "LineString", coordinates: coordinates.slice(i * 2, i * 2 + 3) },
    })) };
    const body = JSON.stringify(payload), sourceKey = `${prefix}:${n}`; sourceKeys.push(sourceKey);
    const input: PilotCandidateInput = { sourceKey, name: `USFS Worker Trail ${n}`, aliases: ["Shared USFS Trail"], kind: "destination", trailheadId: head.id, objectiveId: lake(n).id,
      startSourceVertex: { featureId: "lower", part: 0, vertex: 0 }, endSourceVertex: { featureId: "upper", part: 0, vertex: 2 },
      source: { type: "usfs-nfs-trails", featureIds: ["lower", "upper"], snapshots: [{ path: "usfs.json", sha256: sha256(body), url: sourceUrl(["lower", "upper"]), retrievedAt: `2026-10-0${n}T00:00:00Z` }] } };
    const built = buildCandidate(input, [payload], { trailhead: head, objective: lake(n) });
    const elevation = JSON.stringify({ points: built.points.map((point, i) => ({ ...point, ele: 100 + i * 20 })), lineage: {
      source: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)", sourceUrl: "https://registry.opendata.aws/terrain-tiles/",
      licenseUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", attribution: TERRARIUM_REQUIRED_ATTRIBUTION,
      retrievedAt: "2026-10-01T00:00:00Z", profile: "terrain",
    } });
    writeFileSync(join(dir, "elevation.json"), elevation);
    built.input.elevation = { path: "elevation.json", sha256: sha256(elevation) };
    return { candidate: prepareElevation(built, dir), snapshots: [{ body, sha256: sha256(body) }] };
  };
  try {
    await worker.query("SET statement_timeout='30s'"); await worker.query("SET lock_timeout='5s'");
    for (const p of places) await operator.query(`INSERT INTO destinations(id,name,search_name,features,state_code,country_code,location)
      VALUES($1,$2,lower($2),$3::destination_feature[],$4,$5,ST_SetSRID(ST_MakePoint($6,$7,100),4326)::geography)`,
      [p.id, p.name, p.features, p.stateCode, p.countryCode, p.lng, p.lat]);
    for (const n of [1, 2]) {
      const reviewed = artifact(n);
      await enqueueCandidate(worker, prefix, "a".repeat(64), reviewed);
      const lease = await claimCandidate(worker, reviewed.candidate.input.sourceKey, sha256(stableJson(reviewed)), "usfs-worker-test");
      assert.ok(lease); routeIds.push(lease.proposedRouteId);
      const report = await writePendingCandidate(worker, lease);
      assert.equal(report.routeId, lease.proposedRouteId);
      assert.equal(report.segmentIds?.length, 2, "the source seam creates independently credited spans");
      if (n === 1) segmentIds.push(...report.segmentIds!);
      else assert.deepEqual(report.segmentIds, segmentIds, "unchanged physical spans reuse across retrieval times");
      assert.equal((await worker.query("SELECT trail_catalog_pending_binding_valid($1) AS valid", [report.routeId])).rows[0].valid, true);
      assert.deepEqual((await worker.query(`SELECT trail_catalog_usfs_feature_ids(s.provenance->>'source_url') AS ids
        FROM route_segments rs JOIN segments s ON s.id=rs.segment_id WHERE rs.route_id=$1 ORDER BY rs.ordinal`, [report.routeId])).rows.map(row => row.ids), [["lower"], ["upper"]]);
    }
    await assert.rejects(operator.query("UPDATE routes SET status='active' WHERE id=$1", [routeIds[0]]), /requires independent review; direct activation is disabled/);
    const reviewed = artifact(3); await enqueueCandidate(worker, prefix, "b".repeat(64), reviewed);
    const lease = await claimCandidate(worker, reviewed.candidate.input.sourceKey, sha256(stableJson(reviewed)), "usfs-worker-test");
    assert.ok(lease); routeIds.push(lease.proposedRouteId);
    await worker.query("BEGIN");
    await worker.query("SELECT set_config('peaks.trail_candidate_source_key',$1,true),set_config('peaks.trail_candidate_lease_token',$2,true),set_config('peaks.trail_candidate_span_start','0',true),set_config('peaks.trail_candidate_span_end','2',true)", [lease.sourceKey, lease.token]);
    await assert.rejects(worker.query(`INSERT INTO segments(id,path,provenance)
      SELECT $1,path,$3::jsonb FROM segments WHERE id=$2`, [`${prefix}-padded`, segmentIds[0], JSON.stringify(reviewed.candidate.provenance)]), /reviewed source span/);
    await worker.query("ROLLBACK");
    assert.equal((await operator.query("SELECT count(*)::int AS n FROM segments WHERE id=$1", [`${prefix}-padded`])).rows[0].n, 0);
  } finally {
    await worker.query("ROLLBACK");
    await operator.query("DELETE FROM trail_catalog_candidate_jobs WHERE source_key=ANY($1::text[])", [sourceKeys]);
    await operator.query("DELETE FROM routes WHERE id=ANY($1::text[])", [routeIds]);
    await operator.query("DELETE FROM segments WHERE id=ANY($1::text[])", [[...segmentIds, `${prefix}-padded`]]);
    await operator.query("DELETE FROM destinations WHERE id=ANY($1::text[])", [places.map(p => p.id)]);
    worker.release(); await Promise.all([factory.end(), operator.end()]);
    rmSync(dir, { recursive: true, force: true });
  }
});
const line = (points: number[][]) => `SRID=4326;LINESTRING Z (${points.map(point => point.join(" ")).join(",")})`;

test("USFS SQL pins canonical query URLs, rights, exact feature union, and positive source spans", {
  skip: databaseUrl ? false : "disposable ROUTE_JOB_TEST_DATABASE_URL required",
}, async () => {
  assert.match(new URL(databaseUrl!).pathname, /_test$/);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const prefix = `usfs-gate-${process.pid}-${Date.now()}`;
  const parse = async (url: string) => (await client.query("SELECT trail_catalog_usfs_feature_ids($1) AS ids", [url])).rows[0].ids;
  const compatible = async (segment: unknown, route: unknown) => (await client.query(
    "SELECT route_segment_provenance_compatible($1::jsonb,$2::jsonb) AS valid", [JSON.stringify(segment), JSON.stringify(route)],
  )).rows[0].valid;
  const points = [[0.6, 0.6, 100], [0.601, 0.6, 120], [0.602, 0.6, 140], [0.603, 0.6, 160], [0.604, 0.6, 180]];
  const artifact = { candidate: {
    input: { source: { type: "usfs-nfs-trails" } }, provenance: provenance(["lower", "upper"]),
    elevatedPoints: points.map(([lng, lat, ele]) => ({ lng, lat, ele })),
    edges: ["lower", "lower", "upper", "upper"].map((featureId, i) => ({ featureId, part: 0, startVertex: i % 2, endVertex: i % 2 + 1, names: [] })),
  } };
  const span = async (path: number[][], ids: string[], start: number, end: number, reverse = false, reviewed = artifact) => (
    await client.query("SELECT trail_catalog_span_matches(ST_GeogFromText($1),$2::jsonb,$3::jsonb,$4,$5,$6) AS valid",
      [line(path), JSON.stringify(provenance(ids)), JSON.stringify(reviewed), start, end, reverse])
  ).rows[0].valid;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    for (const ids of [
      ["{B0000000-0000-0000-0000-000000000002}", "{A0000000-0000-0000-0000-000000000001}"],
      ["lower", "upper"], ["quote's", "space here", "plus+percent%", "star*dot.period_"], ["é", "a"],
    ]) {
      const url = sourceUrl(ids);
      assert.equal((await client.query("SELECT trail_catalog_usfs_source_url($1::text[]) AS url", [ids])).rows[0].url, url);
      assert.deepEqual(await parse(url), [...ids].sort());
    }
    const url = sourceUrl(["lower", "upper"]);
    for (const invalid of [
      url.replace("https://", "http://"), url.replace("apps.fs.usda.gov", "example.test"),
      url.replace("MapServer/0", "MapServer/1"), url.replace("globalid+IN", "objectid+IN"),
      url.replace("returnZ=false", "returnZ=true"), `${url}&token=extra`, `${url}#fragment`,
      url.replace("%2C", "%2c"), url.replace("lower", "%FF"), url.replace("lower", "%00"),
      url.replace("lower", "upper"), url.replace("lower", " upper"), url.replace("lower", "%ZZ"),
      url.replace("%27lower%27%2C%27upper%27", "%27upper%27%2C%27lower%27"),
      url.replace("globalid+IN+%28%27lower%27%2C%27upper%27%29", "globalid+IN+%28%27lower%27%2C%29"),
    ]) assert.equal(await parse(invalid), null, invalid);
    for (const ids of [[], [""], ["a", "a"], [" a"], ["a\n"], ["a".repeat(257)], [null]]) {
      assert.equal((await client.query("SELECT trail_catalog_usfs_source_url($1::text[]) AS url", [ids])).rows[0].url, null);
    }
    assert.equal(await compatible(provenance(["lower"], { retrieved_at: "2026-09-01T00:00:00Z" }), provenance(["lower", "upper"])), true);
    assert.equal(await compatible(provenance(["other"]), provenance(["lower", "upper"])), false);
    assert.equal(await compatible(provenance(["lower"]), provenance(["lower", "upper"], { source_url: `${url}&extra=1` })), false);
    for (const changed of [{ license_name: "Public domain" }, { license_url: "https://example.test/license" }, { attribution: "Other agency" }]) {
      assert.equal(await compatible(provenance(["lower"], changed), provenance(["lower", "upper"], changed)), false);
    }
    assert.equal(await compatible(provenance(["lower"], { elevation_profile: "monotonic_ascent" }), provenance(["lower", "upper"])), false);
    assert.equal(await compatible(provenance(["lower"], { source_kind: "other-agency" }), provenance(["lower", "upper"])), false);
    assert.equal(await span(points.slice(0, 3), ["lower"], 0, 2), true);
    assert.equal(await span(points.slice(2).reverse(), ["upper"], 2, 4, true), true);
    assert.equal(await span(points, ["lower", "upper"], 0, 4), true);
    assert.equal(await span(points.slice(0, 3), ["lower", "upper"], 0, 2), false, "unused feature cannot pad a child span");
    assert.equal(await span(points.slice(0, 3), ["upper"], 0, 2), false, "route-level subset alone does not prove child geometry");
    assert.equal(await span(points, ["lower"], 0, 4), false, "all source edges need credit");
    assert.equal(await span([points[0], points[2]], ["lower"], 0, 2), false, "source vertices cannot be skipped");
    assert.equal(await span(points.map(point => [point[0], point[1], point[2] + 1]), ["lower", "upper"], 0, 4), false);
    const zeroArtifact = structuredClone(artifact);
    zeroArtifact.candidate.elevatedPoints[1] = { ...zeroArtifact.candidate.elevatedPoints[0] };
    zeroArtifact.candidate.edges[0].featureId = "upper";
    assert.equal(await span([points[0], points[0], points[2]], ["lower", "upper"], 0, 2, false, zeroArtifact), false,
      "a feature on only a zero-length edge has no source contribution");
    const missing = structuredClone(artifact); missing.candidate.edges.pop();
    assert.equal(await span(points.slice(0, 3), ["lower"], 0, 2, false, missing), false);

    await client.query("INSERT INTO routes(id,name,owner,status,provenance) VALUES($1,'USFS coverage fixture','peaks','pending',$2::jsonb)",
      [prefix, JSON.stringify(provenance(["lower", "upper"]))]);
    for (const [ordinal, ids] of [["lower"], ["upper"]].entries()) {
      await client.query("INSERT INTO segments(id,path,provenance) VALUES($1,ST_GeogFromText($2),$3::jsonb)",
        [`${prefix}-${ordinal}`, line(points.slice(ordinal * 2, ordinal * 2 + 3)), JSON.stringify(provenance(ids))]);
      await client.query("INSERT INTO route_segments(route_id,segment_id,ordinal) VALUES($1,$2,$3)", [prefix, `${prefix}-${ordinal}`, ordinal]);
    }
    const coverage = async () => (await client.query("SELECT route_segments_cover_provenance($1) AS valid", [prefix])).rows[0].valid;
    assert.equal(await coverage(), true);
    await client.query("UPDATE routes SET provenance=$2::jsonb WHERE id=$1", [prefix, JSON.stringify(provenance(["lower", "upper", "unused"]))]);
    assert.equal(await coverage(), false, "every route feature must appear in an independently compatible segment");
    await client.query("UPDATE routes SET provenance=$2::jsonb WHERE id=$1", [prefix, JSON.stringify(provenance(["lower"]))]);
    assert.equal(await coverage(), false, "each segment feature must appear in its route");
  } finally {
    await client.query("ROLLBACK"); client.release(); await pool.end();
  }
});
