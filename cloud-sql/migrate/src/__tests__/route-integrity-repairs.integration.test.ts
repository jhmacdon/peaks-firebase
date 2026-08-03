import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const TEST_DATABASE_URL = process.env.ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");
const REPAIR_MIGRATION = join(MIGRATE_ROOT, "../migrations/20260803_route_integrity_repairs.sql");

test(
  "shared bad routes require every summit to be covered and feed the repair job safely",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL not set" },
  async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.match(url.pathname, /_test$/, "route integrity tests require a disposable *_test database");
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const suffix = `${process.pid}-${Date.now()}`;
    const destinationA = `integrity-a-${suffix}`;
    const destinationB = `integrity-b-${suffix}`;
    const badRoute = `integrity-bad-${suffix}`;
    const goodA = `integrity-good-a-${suffix}`;
    const sharedReplacement = `integrity-shared-replacement-${suffix}`;
    const userA = `integrity-user-a-${suffix}`;
    const invalidProfile = `integrity-invalid-profile-${suffix}`;
    const invalidProvenance = `integrity-invalid-provenance-${suffix}`;
    const invalidSegment = `integrity-invalid-segment-${suffix}`;
    const missingSegment = `integrity-missing-segment-${suffix}`;
    const disconnectedSegment = `integrity-disconnected-segment-${suffix}`;
    const nonSummitEndpoint = `integrity-non-summit-endpoint-${suffix}`;
    const liveRoute = `integrity-live-${suffix}`;
    const settlementBad = `integrity-settlement-bad-${suffix}`;
    const settlementA = `integrity-settlement-a-${suffix}`;
    const settlementB = `integrity-settlement-b-${suffix}`;
    const nonSummit = `integrity-non-summit-${suffix}`;
    const ids = [badRoute, goodA, sharedReplacement, userA, invalidProfile, invalidProvenance, invalidSegment, missingSegment, disconnectedSegment, nonSummitEndpoint, liveRoute, settlementBad, settlementA, settlementB];
    const provenance = JSON.stringify({
      source_kind: "test", source_url: "https://example.test/source", license_name: "Test license",
      license_url: "https://example.test/license", attribution: "Test", retrieved_at: "2026-08-03T00:00:00Z",
      osm_way_ids: [], osm_way_urls: [], contains_osm_geometry: false,
    });
    const command = (file: string, ...args: string[]) => {
      const result = spawnSync(join(MIGRATE_ROOT, "node_modules/.bin/tsx"), [join(MIGRATE_ROOT, "src", file), ...args], {
        cwd: MIGRATE_ROOT, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || "5432", DB_NAME: url.pathname.slice(1), DB_USER: decodeURIComponent(url.username), DB_PASS: decodeURIComponent(url.password) },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout.trim());
    };
    const insertRoute = async (id: string, owner: string, line: string, profile = true, routeProvenance: string | null = provenance, shape = "loop") => {
      await pool.query(
        `INSERT INTO routes (id, owner, status, shape, path, provenance, elevation_string)
         VALUES ($1, $2, 'active', $6::route_shape, ST_GeogFromText($3), $4::jsonb,
                 CASE WHEN $5 THEN encode_route_elevation_profile(ST_GeogFromText($3)) ELSE NULL END)`,
        [id, owner, line, routeProvenance, profile, shape]
      );
    };
    const link = (route: string, destination: string, ordinal: number) => pool.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, $3)`, [route, destination, ordinal]
    );
    const segment = async (route: string, id: string, line: string, source = provenance, ordinal = 0, direction = "forward") => {
      await pool.query(
        `INSERT INTO segments (id, path, provenance) VALUES ($1, ST_GeogFromText($2), $3::jsonb)`, [id, line, source]
      );
      await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES ($1, $2, $3, $4)`, [route, id, ordinal, direction]);
    };
    try {
      await pool.query(await readFile(REPAIR_MIGRATION, "utf8"));
      await pool.query(`INSERT INTO destinations (id, features, location) VALUES
        ($1, ARRAY['summit']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-121 47 1000)')),
        ($2, ARRAY['summit']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-122 48 1000)')),
        ($3, ARRAY[]::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-122.00001 48.00001 1010)'))`, [destinationA, destinationB, nonSummit]);
      const nearA = "SRID=4326;LINESTRING Z (-121 47 1000, -121.00001 47.00001 1010)";
      const nearB = "SRID=4326;LINESTRING Z (-122 48 1000, -122.00001 48.00001 1010)";
      const throughAThenB = "SRID=4326;LINESTRING Z (-121 47 1000, -122 48 1000)";
      const disconnectedB = "SRID=4326;LINESTRING Z (-122.01 48.01 1000, -122.01001 48.01001 1010)";
      await insertRoute(badRoute, "peaks", nearA); await link(badRoute, destinationA, 0); await link(badRoute, destinationB, 1); await segment(badRoute, `${badRoute}-segment`, nearA);
      await insertRoute(goodA, "peaks", nearA); await link(goodA, destinationA, 0); await segment(goodA, `${goodA}-segment`, nearA);
      await insertRoute(userA, "user-test", nearA); await link(userA, destinationA, 0);
      await insertRoute(invalidProfile, "peaks", nearB, false); await link(invalidProfile, destinationB, 0); await segment(invalidProfile, `${invalidProfile}-segment`, nearB);
      await insertRoute(invalidProvenance, "peaks", nearB, true, null); await link(invalidProvenance, destinationB, 0);
      await insertRoute(invalidSegment, "peaks", nearB); await link(invalidSegment, destinationB, 0); await segment(invalidSegment, `${invalidSegment}-segment`, nearB, JSON.stringify({ ...JSON.parse(provenance), source_kind: "other" }));
      await insertRoute(missingSegment, "peaks", nearB); await link(missingSegment, destinationB, 0);
      await pool.query(`INSERT INTO segments (id, provenance) VALUES ($1, $2::jsonb)`, [`${missingSegment}-segment`, provenance]);
      await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)`, [missingSegment, `${missingSegment}-segment`]);
      await insertRoute(disconnectedSegment, "peaks", nearB); await link(disconnectedSegment, destinationB, 0);
      await segment(disconnectedSegment, `${disconnectedSegment}-first`, nearB);
      await segment(disconnectedSegment, `${disconnectedSegment}-second`, disconnectedB, provenance, 1);
      await insertRoute(nonSummitEndpoint, "peaks", nearB, true, provenance, "out_and_back"); await link(nonSummitEndpoint, destinationB, 0); await link(nonSummitEndpoint, nonSummit, 1); await segment(nonSummitEndpoint, `${nonSummitEndpoint}-segment`, nearB);
      await insertRoute(liveRoute, "peaks", nearA); await link(liveRoute, destinationB, 0); await segment(liveRoute, `${liveRoute}-segment`, nearA);

      command("route-integrity-repairs.ts", "seed", "--apply");
      const first = await pool.query<{ destination_id: string; state: string; replacement_route_id: string | null }>(
        `SELECT destination_id, state, replacement_route_id FROM route_integrity_repairs WHERE route_id = $1 ORDER BY destination_id`, [badRoute]
      );
      assert.deepEqual(first.rows, [
        { destination_id: destinationA, state: "covered", replacement_route_id: goodA },
        { destination_id: destinationB, state: "queued", replacement_route_id: null },
      ]);
      assert.equal((await pool.query(`SELECT status FROM routes WHERE id = $1`, [badRoute])).rows[0]?.status, "active");

      await pool.query(
        `INSERT INTO standard_route_backfill_jobs (destination_id, state, priority, target_reasons, replacement_route_id, lease_owner, lease_token, lease_expires_at, blocker_code, evidence)
         VALUES ($1, 'researching', 7, '{"sentinel":true}', $2, 'worker', 'live-token', now() + interval '1 hour', 'keep', '{"keep":true}')`,
        [destinationB, liveRoute]
      );
      command("standard-route-jobs.ts", "seed", "--apply");
      const leased = await pool.query<{ state: string; replacement_route_id: string; blocker_code: string; evidence: unknown; priority: number; target_reasons: unknown }>(
        `SELECT state, replacement_route_id, blocker_code, evidence, priority, target_reasons FROM standard_route_backfill_jobs WHERE destination_id = $1`, [destinationB]
      );
      assert.equal(leased.rows[0]?.state, "researching");
      assert.equal(leased.rows[0]?.replacement_route_id, liveRoute);
      assert.equal(leased.rows[0]?.blocker_code, "keep");
      assert.deepEqual(leased.rows[0]?.evidence, { keep: true });
      assert.equal(leased.rows[0]?.priority, 7);
      assert.deepEqual(leased.rows[0]?.target_reasons, { sentinel: true });

      await pool.query(`UPDATE standard_route_backfill_jobs SET lease_expires_at = now() - interval '1 minute' WHERE destination_id = $1`, [destinationB]);
      command("standard-route-jobs.ts", "seed", "--apply");
      const queued = await pool.query<{ state: string; replacement_route_id: string }>(
        `SELECT state, replacement_route_id FROM standard_route_backfill_jobs WHERE destination_id = $1`, [destinationB]
      );
      assert.deepEqual(queued.rows[0], { state: "queued", replacement_route_id: badRoute });

      await pool.query(`UPDATE routes SET elevation_string = NULL WHERE id = $1`, [goodA]);
      command("route-integrity-repairs.ts", "seed", "--apply");
      assert.equal((await pool.query(`SELECT state FROM route_integrity_repairs WHERE route_id = $1 AND destination_id = $2`, [badRoute, destinationA])).rows[0]?.state, "queued");
      await insertRoute(sharedReplacement, "peaks", throughAThenB, true, provenance, "point_to_point");
      await link(sharedReplacement, destinationA, 0); await link(sharedReplacement, destinationB, 1);
      await segment(sharedReplacement, `${sharedReplacement}-segment`, throughAThenB);
      command("route-integrity-repairs.ts", "seed", "--apply");
      const sharedCoverage = await pool.query<{ destination_id: string; replacement_route_id: string; state: string }>(
        `SELECT destination_id, replacement_route_id, state
         FROM route_integrity_repairs WHERE route_id = $1 ORDER BY destination_id`, [badRoute]
      );
      assert.deepEqual(sharedCoverage.rows, [
        { destination_id: destinationA, replacement_route_id: sharedReplacement, state: "covered" },
        { destination_id: destinationB, replacement_route_id: sharedReplacement, state: "covered" },
      ]);
      assert.equal((await pool.query(`SELECT status FROM routes WHERE id = $1`, [badRoute])).rows[0]?.status, "active");
      await pool.query(`UPDATE routes SET elevation_string = NULL WHERE id = $1`, [sharedReplacement]);
      const refusedRetirement = command(
        "route-integrity-repairs.ts",
        "retire-covered",
        "--route-id",
        badRoute,
        "--apply"
      );
      assert.equal(refusedRetirement.retired, false);
      assert.equal(refusedRetirement.requeued_invalid_coverage, 2);
      assert.equal((await pool.query(`SELECT status FROM routes WHERE id = $1`, [badRoute])).rows[0]?.status, "active");
      await pool.query(
        `UPDATE routes SET elevation_string = encode_route_elevation_profile(path) WHERE id = $1`,
        [sharedReplacement]
      );
      command("route-integrity-repairs.ts", "seed", "--apply");
      const retirement = command(
        "route-integrity-repairs.ts",
        "retire-covered",
        "--route-id",
        badRoute,
        "--apply"
      );
      assert.equal(retirement.retired, true);
      assert.equal(retirement.invalid_coverage_links, 0);
      assert.equal((await pool.query(`SELECT status FROM routes WHERE id = $1`, [badRoute])).rows[0]?.status, "superseded");

      await insertRoute(settlementBad, "peaks", nearA);
      await link(settlementBad, destinationA, 0);
      await link(settlementBad, destinationB, 1);
      await segment(settlementBad, `${settlementBad}-segment`, nearA);
      await insertRoute(settlementA, "peaks", nearA);
      await link(settlementA, destinationA, 0);
      await segment(settlementA, `${settlementA}-segment`, nearA);
      await insertRoute(settlementB, "peaks", nearB);
      await link(settlementB, destinationB, 0);
      await segment(settlementB, `${settlementB}-segment`, nearB);
      await pool.query(
        `INSERT INTO route_integrity_repairs (
           route_id, destination_id, state, reason
         ) VALUES
           ($1, $2, 'queued', 'summit_path_gap'),
           ($1, $3, 'queued', 'summit_path_gap')`,
        [settlementBad, destinationA, destinationB]
      );
      const afterFirstSettlement = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [settlementBad, destinationA, settlementA]
      );
      assert.equal(afterFirstSettlement.rows[0]?.status, "active");
      assert.equal(
        (await pool.query(`SELECT status FROM routes WHERE id = $1`, [settlementBad])).rows[0]?.status,
        "active"
      );
      assert.deepEqual(
        (await pool.query(
          `SELECT destination_id, state, replacement_route_id
           FROM route_integrity_repairs
           WHERE route_id = $1 ORDER BY destination_id`,
          [settlementBad]
        )).rows,
        [
          { destination_id: destinationA, state: "covered", replacement_route_id: settlementA },
          { destination_id: destinationB, state: "queued", replacement_route_id: null },
        ]
      );
      const afterLastSettlement = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [settlementBad, destinationB, settlementB]
      );
      assert.equal(afterLastSettlement.rows[0]?.status, "superseded");
      assert.equal(
        (await pool.query(`SELECT status FROM routes WHERE id = $1`, [settlementBad])).rows[0]?.status,
        "superseded"
      );
    } finally {
      await pool.query(`DELETE FROM standard_route_backfill_jobs WHERE destination_id = ANY($1::text[])`, [[destinationA, destinationB]]);
      await pool.query(`DELETE FROM route_integrity_repairs WHERE route_id = ANY($1::text[])`, [ids]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [ids]);
      await pool.query(`DELETE FROM destinations WHERE id = ANY($1::text[])`, [[destinationA, destinationB, nonSummit]]);
      await pool.end();
    }
  }
);
