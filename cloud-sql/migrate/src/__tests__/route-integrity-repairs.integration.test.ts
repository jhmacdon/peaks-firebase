import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { Pool, type QueryResult } from "pg";

const TEST_DATABASE_URL = process.env.ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

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
    const trailheadA = `integrity-trailhead-a-${suffix}`;
    const trailheadB = `integrity-trailhead-b-${suffix}`;
    const distantTrailhead = `integrity-trailhead-distant-${suffix}`;
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
    const trailheadGapBad = `integrity-trailhead-gap-bad-${suffix}`;
    const trailheadGapReplacementA = `integrity-trailhead-gap-replacement-a-${suffix}`;
    const derivedBad = `integrity-derived-bad-${suffix}`;
    const derivedA = `integrity-derived-a-${suffix}`;
    const derivedB = `integrity-derived-b-${suffix}`;
    const ordinaryOld = `integrity-ordinary-old-${suffix}`;
    const ordinaryNew = `integrity-ordinary-new-${suffix}`;
    const partialBad = `integrity-partial-bad-${suffix}`;
    const concurrentBad = `integrity-concurrent-bad-${suffix}`;
    const nonSummit = `integrity-non-summit-${suffix}`;
    const ids = [badRoute, goodA, sharedReplacement, userA, invalidProfile, invalidProvenance, invalidSegment, missingSegment, disconnectedSegment, nonSummitEndpoint, liveRoute, settlementBad, settlementA, settlementB, trailheadGapBad, trailheadGapReplacementA, derivedBad, derivedA, derivedB, ordinaryOld, ordinaryNew, partialBad, concurrentBad];
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
        `INSERT INTO routes (
           id, owner, status, shape, path, provenance, elevation_string,
           gain, gain_loss
         )
         VALUES ($1, $2, 'active', $6::route_shape, ST_GeogFromText($3), $4::jsonb,
                 CASE WHEN $5 THEN encode_route_elevation_profile(ST_GeogFromText($3)) ELSE NULL END,
                 (SELECT gain FROM route_elevation_stats(ST_GeogFromText($3))),
                 (SELECT loss FROM route_elevation_stats(ST_GeogFromText($3))))`,
        [id, owner, line, routeProvenance, profile, shape]
      );
      if (!profile) {
        // trg_routes_materialize_peaks_elevation_profile rebuilds elevation_string
        // from path on INSERT for owner = 'peaks', so the NULL set above never
        // lands. Only an UPDATE that doesn't touch path/owner can leave it unset.
        await pool.query(`UPDATE routes SET elevation_string = NULL WHERE id = $1`, [id]);
      }
    };
    const link = (route: string, destination: string, ordinal: number) => pool.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, $3)`, [route, destination, ordinal]
    );
    const segment = async (route: string, id: string, line: string, source = provenance, ordinal = 0, direction = "forward") => {
      await pool.query(
        `INSERT INTO segments (id, path, gain, gain_loss, provenance)
         VALUES (
           $1,
           ST_GeogFromText($2),
           (SELECT gain FROM route_elevation_stats(ST_GeogFromText($2))),
           (SELECT loss FROM route_elevation_stats(ST_GeogFromText($2))),
           $3::jsonb
         )`,
        [id, line, source]
      );
      await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES ($1, $2, $3, $4)`, [route, id, ordinal, direction]);
    };
    try {
      // 20260803_route_integrity_repairs.sql is applied by test-db/provision.sh
      // as the admin role (locally and in CI). The test role deliberately holds
      // no DDL on schema public — see test-db/grants.sql.
      await pool.query(`INSERT INTO destinations (id, search_name, features, location, country_code) VALUES
        ($1, 'destination a', ARRAY['summit']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-121 47 1000)'), 'US'),
        ($2, 'destination b', ARRAY['summit']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-122 48 1000)'), 'US'),
        ($3, 'non summit', ARRAY[]::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-122.00001 48.00001 1010)'), 'US'),
        ($4, 'trailhead a', ARRAY['trailhead']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-121 47 900)'), 'US'),
        ($5, 'trailhead b', ARRAY['trailhead']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-122 48 900)'), 'US'),
        ($6, 'distant trailhead', ARRAY['trailhead']::destination_feature[], ST_GeogFromText('SRID=4326;POINT Z (-121.01 47.01 900)'), 'US')`, [destinationA, destinationB, nonSummit, trailheadA, trailheadB, distantTrailhead]);
      const nearA = "SRID=4326;LINESTRING Z (-121 47 1000, -121.00001 47.00001 1010)";
      const nearB = "SRID=4326;LINESTRING Z (-122 48 1000, -122.00001 48.00001 1010)";
      const throughAThenB = "SRID=4326;LINESTRING Z (-121 47 1000, -122 48 1010)";
      const disconnectedB = "SRID=4326;LINESTRING Z (-122.01 48.01 1000, -122.01001 48.01001 1010)";
      await insertRoute(badRoute, "peaks", nearA); await link(badRoute, trailheadA, 0); await link(badRoute, destinationA, 1); await link(badRoute, destinationB, 2); await segment(badRoute, `${badRoute}-segment`, nearA);
      await insertRoute(goodA, "peaks", nearA); await link(goodA, trailheadA, 0); await link(goodA, destinationA, 1); await segment(goodA, `${goodA}-segment`, nearA);
      await insertRoute(userA, "user-test", nearA); await link(userA, trailheadA, 0); await link(userA, destinationA, 1);
      await insertRoute(invalidProfile, "peaks", nearB, false); await link(invalidProfile, trailheadB, 0); await link(invalidProfile, destinationB, 1); await segment(invalidProfile, `${invalidProfile}-segment`, nearB);
      await insertRoute(invalidProvenance, "peaks", nearB, true, null); await link(invalidProvenance, trailheadB, 0); await link(invalidProvenance, destinationB, 1);
      await insertRoute(invalidSegment, "peaks", nearB); await link(invalidSegment, trailheadB, 0); await link(invalidSegment, destinationB, 1); await segment(invalidSegment, `${invalidSegment}-segment`, nearB, JSON.stringify({ ...JSON.parse(provenance), source_kind: "other" }));
      await insertRoute(missingSegment, "peaks", nearB); await link(missingSegment, trailheadB, 0); await link(missingSegment, destinationB, 1);
      await pool.query(`INSERT INTO segments (id, provenance) VALUES ($1, $2::jsonb)`, [`${missingSegment}-segment`, provenance]);
      await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)`, [missingSegment, `${missingSegment}-segment`]);
      await insertRoute(disconnectedSegment, "peaks", nearB); await link(disconnectedSegment, trailheadB, 0); await link(disconnectedSegment, destinationB, 1);
      await segment(disconnectedSegment, `${disconnectedSegment}-first`, nearB);
      await segment(disconnectedSegment, `${disconnectedSegment}-second`, disconnectedB, provenance, 1);
      await insertRoute(nonSummitEndpoint, "peaks", nearB, true, provenance, "out_and_back"); await link(nonSummitEndpoint, trailheadB, 0); await link(nonSummitEndpoint, destinationB, 1); await link(nonSummitEndpoint, nonSummit, 2); await segment(nonSummitEndpoint, `${nonSummitEndpoint}-segment`, nearB);
      await insertRoute(liveRoute, "peaks", nearA); await link(liveRoute, trailheadA, 0); await link(liveRoute, destinationB, 1); await segment(liveRoute, `${liveRoute}-segment`, nearA);

      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT peaks_route_passes_publish_integrity(
             $1, $2, 'active'
           ) AS valid`,
          [goodA, destinationA]
        )).rows[0]?.valid,
        true
      );
      await pool.query(
        `UPDATE destinations
         SET location = ST_GeogFromText(
           'SRID=4326;POINT Z (-121.01 47.01 900)'
         )
         WHERE id = $1`,
        [trailheadA]
      );
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT peaks_route_passes_publish_integrity(
             $1, $2, 'active'
           ) AS valid`,
          [goodA, destinationA]
        )).rows[0]?.valid,
        false,
        "an ordinal-zero trailhead beyond 125 m must fail publish integrity"
      );
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT peaks_route_passes_publish_integrity(
             $1, NULL, 'active'
           ) AS valid`,
          [goodA]
        )).rows[0]?.valid,
        false,
        "route-global publish integrity must enforce the trailhead start gap"
      );
      await pool.query(
        `UPDATE destinations
         SET location = ST_GeogFromText(
           'SRID=4326;POINT Z (-121 47 900)'
         )
         WHERE id = $1`,
        [trailheadA]
      );
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT peaks_route_passes_publish_integrity(
             $1, $2, 'active'
           ) AS valid`,
          [goodA, destinationA]
        )).rows[0]?.valid,
        true,
        "restoring the ordinal-zero trailhead must restore publish integrity"
      );
      await pool.query(
        `UPDATE segments SET gain = gain + 1 WHERE id = $1`,
        [`${goodA}-segment`]
      );
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT peaks_route_passes_publish_integrity(
             $1, $2, 'active'
           ) AS valid`,
          [goodA, destinationA]
        )).rows[0]?.valid,
        false,
        "wrong stored segment stats must fail publish integrity"
      );
      await pool.query(
        `UPDATE segments
         SET gain = (SELECT gain FROM route_elevation_stats(segments.path)),
             gain_loss = (
               SELECT loss FROM route_elevation_stats(segments.path)
             )
         WHERE id = $1`,
        [`${goodA}-segment`]
      );

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

      for (const state of [
        "candidate_ready",
        "pending_review",
        "approved",
        "needs_revision",
      ]) {
        await pool.query(
          `UPDATE standard_route_backfill_jobs
           SET state = $2::text,
               evidence = jsonb_build_object('state', $2::text),
               candidate = jsonb_build_object('state', $2::text),
               review = jsonb_build_object('state', $2::text),
               candidate_path = '/tmp/repair-candidate.json',
               candidate_sha256 = repeat('b', 64),
               candidate_artifact = jsonb_build_object('state', $2::text),
               published_route_id = $3,
               replacement_route_id = $4,
               blocker_code = 'preserve_repair_work',
               blocker_message = 'Preserve repair work',
               last_error = 'preserve repair error',
               next_attempt_at = now() + interval '1 day',
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL
           WHERE destination_id = $1`,
          [destinationB, state, liveRoute, badRoute]
        );
        command("standard-route-jobs.ts", "seed", "--apply");
        const preserved = (
          await pool.query<{
            blocker_code: string | null;
            blocker_message: string | null;
            candidate: unknown;
            candidate_artifact: unknown;
            candidate_path: string | null;
            candidate_sha256: string | null;
            evidence: unknown;
            last_error: string | null;
            next_attempt_preserved: boolean;
            published_route_id: string | null;
            replacement_route_id: string | null;
            review: unknown;
            state: string;
          }>(
            `SELECT state, evidence, candidate, review, candidate_path,
                    candidate_sha256, candidate_artifact,
                    published_route_id, replacement_route_id,
                    blocker_code, blocker_message, last_error,
                    next_attempt_at > now() AS next_attempt_preserved
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [destinationB]
          )
        ).rows[0];
        assert.deepEqual(preserved, {
          blocker_code: "preserve_repair_work",
          blocker_message: "Preserve repair work",
          candidate: { state },
          candidate_artifact: { state },
          candidate_path: "/tmp/repair-candidate.json",
          candidate_sha256: "b".repeat(64),
          evidence: { state },
          last_error: "preserve repair error",
          next_attempt_preserved: true,
          published_route_id: liveRoute,
          replacement_route_id: badRoute,
          review: { state },
          state,
        });
      }

      await pool.query(`UPDATE routes SET elevation_string = NULL WHERE id = $1`, [goodA]);
      command("route-integrity-repairs.ts", "seed", "--apply");
      assert.equal((await pool.query(`SELECT state FROM route_integrity_repairs WHERE route_id = $1 AND destination_id = $2`, [badRoute, destinationA])).rows[0]?.state, "queued");
      await insertRoute(sharedReplacement, "peaks", throughAThenB, true, provenance, "point_to_point");
      await link(sharedReplacement, trailheadA, 0); await link(sharedReplacement, destinationA, 1); await link(sharedReplacement, destinationB, 2);
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
      await link(settlementBad, trailheadA, 0);
      await link(settlementBad, destinationA, 1);
      await link(settlementBad, destinationB, 2);
      await segment(settlementBad, `${settlementBad}-segment`, nearA);
      await insertRoute(settlementA, "peaks", nearA);
      await link(settlementA, trailheadA, 0);
      await link(settlementA, destinationA, 1);
      await segment(settlementA, `${settlementA}-segment`, nearA);
      await insertRoute(settlementB, "peaks", nearB);
      await link(settlementB, trailheadB, 0);
      await link(settlementB, destinationB, 1);
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

      await insertRoute(trailheadGapBad, "peaks", throughAThenB, true, provenance, "point_to_point");
      await link(trailheadGapBad, distantTrailhead, 0);
      await link(trailheadGapBad, destinationA, 1);
      await link(trailheadGapBad, destinationB, 2);
      await segment(trailheadGapBad, `${trailheadGapBad}-segment`, throughAThenB);
      await insertRoute(trailheadGapReplacementA, "peaks", nearA);
      await link(trailheadGapReplacementA, trailheadA, 0);
      await link(trailheadGapReplacementA, destinationA, 1);
      await segment(trailheadGapReplacementA, `${trailheadGapReplacementA}-segment`, nearA);
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT peaks_route_passes_publish_integrity(
             $1, NULL, 'active'
           ) AS valid`,
          [trailheadGapBad]
        )).rows[0]?.valid,
        false,
        "a shared route with a distant ordinal-zero trailhead must fail route-global integrity"
      );
      const trailheadGapSettlement = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [trailheadGapBad, destinationA, trailheadGapReplacementA]
      );
      assert.equal(trailheadGapSettlement.rows[0]?.status, "active");
      assert.equal(
        (await pool.query(`SELECT status FROM routes WHERE id = $1`, [trailheadGapBad])).rows[0]?.status,
        "active",
        "the first shared-route replacement must not retire the old route"
      );
      assert.deepEqual(
        (await pool.query(
          `SELECT destination_id, state, replacement_route_id
           FROM route_integrity_repairs
           WHERE route_id = $1 ORDER BY destination_id`,
          [trailheadGapBad]
        )).rows,
        [
          { destination_id: destinationA, state: "covered", replacement_route_id: trailheadGapReplacementA },
          { destination_id: destinationB, state: "queued", replacement_route_id: null },
        ]
      );

      await insertRoute(derivedBad, "peaks", nearA);
      await link(derivedBad, trailheadA, 0);
      await link(derivedBad, destinationA, 1);
      await link(derivedBad, destinationB, 2);
      await segment(derivedBad, `${derivedBad}-segment`, nearA);
      await insertRoute(derivedA, "peaks", nearA);
      await link(derivedA, trailheadA, 0);
      await link(derivedA, destinationA, 1);
      await segment(derivedA, `${derivedA}-segment`, nearA);
      await insertRoute(derivedB, "peaks", nearB);
      await link(derivedB, trailheadB, 0);
      await link(derivedB, destinationB, 1);
      await segment(derivedB, `${derivedB}-segment`, nearB);

      const derivedFirst = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [derivedBad, destinationA, derivedA]
      );
      assert.equal(derivedFirst.rows[0]?.status, "active");
      assert.equal(
        (await pool.query(`SELECT status FROM routes WHERE id = $1`, [derivedBad])).rows[0]?.status,
        "active"
      );
      assert.deepEqual(
        (await pool.query(
          `SELECT destination_id, state, replacement_route_id
           FROM route_integrity_repairs
           WHERE route_id = $1 ORDER BY destination_id`,
          [derivedBad]
        )).rows,
        [
          { destination_id: destinationA, state: "covered", replacement_route_id: derivedA },
          { destination_id: destinationB, state: "queued", replacement_route_id: null },
        ]
      );
      const derivedLast = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [derivedBad, destinationB, derivedB]
      );
      assert.equal(derivedLast.rows[0]?.status, "superseded");

      await insertRoute(partialBad, "peaks", nearA);
      await link(partialBad, trailheadA, 0);
      await link(partialBad, destinationA, 1);
      await link(partialBad, destinationB, 2);
      await segment(partialBad, `${partialBad}-segment`, nearA);
      await pool.query(
        `INSERT INTO route_integrity_repairs (
           route_id, destination_id, state, reason
         ) VALUES ($1, $2, 'queued', 'summit_path_gap')`,
        [partialBad, destinationA]
      );
      const partialFirst = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [partialBad, destinationA, derivedA]
      );
      assert.equal(partialFirst.rows[0]?.status, "active");
      assert.deepEqual(
        (await pool.query(
          `SELECT destination_id, state FROM route_integrity_repairs
           WHERE route_id = $1 ORDER BY destination_id`,
          [partialBad]
        )).rows,
        [
          { destination_id: destinationA, state: "covered" },
          { destination_id: destinationB, state: "queued" },
        ]
      );
      const partialLast = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [partialBad, destinationB, derivedB]
      );
      assert.equal(partialLast.rows[0]?.status, "superseded");

      await insertRoute(ordinaryOld, "peaks", nearA);
      await link(ordinaryOld, trailheadA, 0);
      await link(ordinaryOld, destinationA, 1);
      await segment(ordinaryOld, `${ordinaryOld}-segment`, nearA);
      await insertRoute(ordinaryNew, "peaks", nearA);
      await link(ordinaryNew, trailheadA, 0);
      await link(ordinaryNew, destinationA, 1);
      await segment(ordinaryNew, `${ordinaryNew}-segment`, nearA);
      const ordinary = await pool.query<{ status: string }>(
        `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
        [ordinaryOld, destinationA, ordinaryNew]
      );
      assert.equal(ordinary.rows[0]?.status, "superseded");
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS count FROM route_integrity_repairs WHERE route_id = $1`, [ordinaryOld])).rows[0]?.count,
        0
      );

      await insertRoute(concurrentBad, "peaks", nearA);
      await link(concurrentBad, trailheadA, 0);
      await link(concurrentBad, destinationA, 1);
      await link(concurrentBad, destinationB, 2);
      await segment(concurrentBad, `${concurrentBad}-segment`, nearA);
      const firstClient = await pool.connect();
      const secondClient = await pool.connect();
      let secondSettlement: Promise<QueryResult<{ status: string }>> | undefined;
      try {
        await firstClient.query("BEGIN");
        await secondClient.query("BEGIN");
        await secondClient.query("SET LOCAL statement_timeout = '10s'");
        const firstSettlement = await firstClient.query<{ status: string }>(
          `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
          [concurrentBad, destinationA, derivedA]
        );
        assert.equal(firstSettlement.rows[0]?.status, "active");
        const secondPid = (
          await secondClient.query<{ pid: number }>(`SELECT pg_backend_pid()::int AS pid`)
        ).rows[0]!.pid;
        secondSettlement = secondClient.query<{ status: string }>(
          `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
          [concurrentBad, destinationB, derivedB]
        );
        let advisoryWait: {
          wait_event_type: string | null;
          wait_event: string | null;
          blockers: number[];
          destination_locks: number;
        } | undefined;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const activity = await pool.query<{
            wait_event_type: string | null;
            wait_event: string | null;
            blockers: number[];
            destination_locks: number;
          }>(
            `SELECT
               activity.wait_event_type,
               activity.wait_event,
               pg_blocking_pids(activity.pid) AS blockers,
               (
                 SELECT count(*)::int
                 FROM pg_locks held
                 JOIN pg_class locked_relation ON locked_relation.oid = held.relation
                 WHERE held.pid = activity.pid
                   AND held.granted
                   AND held.mode = 'RowShareLock'
                   AND locked_relation.relname IN ('destinations', 'route_destinations')
               ) AS destination_locks
             FROM pg_stat_activity activity
             WHERE activity.pid = $1`,
            [secondPid]
          );
          if (activity.rows[0]?.wait_event?.toLowerCase() === "advisory") {
            advisoryWait = activity.rows[0];
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(advisoryWait?.wait_event_type, "Lock");
        assert.equal(advisoryWait?.wait_event?.toLowerCase(), "advisory");
        assert.ok((advisoryWait?.blockers.length ?? 0) >= 1);
        assert.equal(advisoryWait?.destination_locks, 0);
        await firstClient.query("COMMIT");
        assert.equal((await secondSettlement).rows[0]?.status, "superseded");
        await secondClient.query("COMMIT");
        assert.equal(
          (await pool.query(`SELECT status FROM routes WHERE id = $1`, [concurrentBad])).rows[0]?.status,
          "superseded"
        );
      } finally {
        await firstClient.query("ROLLBACK").catch(() => undefined);
        await secondSettlement?.catch(() => undefined);
        await secondClient.query("ROLLBACK").catch(() => undefined);
        firstClient.release();
        secondClient.release();
      }
    } finally {
      await pool.query(`DELETE FROM standard_route_backfill_jobs WHERE destination_id = ANY($1::text[])`, [[destinationA, destinationB]]);
      await pool.query(`DELETE FROM route_integrity_repairs WHERE route_id = ANY($1::text[])`, [ids]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [ids]);
      await pool.query(`DELETE FROM destinations WHERE id = ANY($1::text[])`, [[destinationA, destinationB, nonSummit, trailheadA, trailheadB, distantTrailhead]]);
      await pool.end();
    }
  }
);
