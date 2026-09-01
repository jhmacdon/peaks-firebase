import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

type TargetReasons = {
  country_code_valid: boolean;
  high_popularity: boolean;
  integrity_repair: boolean;
  list_names: string[];
  summit_feature_valid: boolean;
  target_list: boolean;
  ultra_prominent: boolean;
};

type TargetJob = {
  blocker_code: string | null;
  destination_id: string;
  published_route_id: string | null;
  state: string;
  target_reasons: TargetReasons;
};

test(
  "seed targets every Peaks-owned list while preserving other target reasons",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "route target tests require a disposable *_test database"
    );

    const suffix = `${process.pid}-${Date.now()}`;
    const peaksListA = `route-target-peaks-a-${suffix}`;
    const peaksListB = `route-target-peaks-b-${suffix}`;
    const userList = `route-target-user-${suffix}`;
    const listedDestination = `route-target-listed-${suffix}`;
    const userListDestination = `route-target-user-only-${suffix}`;
    const ultraDestination = `route-target-ultra-${suffix}`;
    const popularDestination = `route-target-popular-${suffix}`;
    const missingFeatureDestination = `route-target-not-summit-${suffix}`;
    const invalidCountryDestination = `route-target-invalid-country-${suffix}`;
    const unseededDestination = `route-target-unseeded-${suffix}`;
    const peaksListNameA = `Alpine circuit ${suffix}`;
    const peaksListNameB = `World summits ${suffix}`;
    const userListName = `Private list ${suffix}`;
    const destinationIds = [
      listedDestination,
      userListDestination,
      ultraDestination,
      popularDestination,
      missingFeatureDestination,
      invalidCountryDestination,
      unseededDestination,
    ];
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const command = (...args: string[]) =>
      spawnSync(
        join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
        [join(MIGRATE_ROOT, "src/standard-route-jobs.ts"), ...args],
        {
          cwd: MIGRATE_ROOT,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            DB_HOST: databaseUrl.hostname,
            DB_PORT: databaseUrl.port || "5432",
            DB_NAME: databaseUrl.pathname.slice(1),
            DB_USER: decodeURIComponent(databaseUrl.username),
            DB_PASS: decodeURIComponent(databaseUrl.password),
          },
        }
      );

    try {
      await pool.query(
        `INSERT INTO destinations (
           id, name, search_name, features, prominence, session_count_offset,
           country_code
         ) VALUES
           ($1, 'Listed test summit', 'listed test summit',
            ARRAY['summit']::destination_feature[], 10, 0, 'US'),
           ($2, 'User-list test summit', 'user-list test summit',
            ARRAY['summit']::destination_feature[], 10, 0, 'US'),
           ($3, 'Ultra test summit', 'ultra test summit',
            ARRAY['summit']::destination_feature[], 1500, 0, 'US'),
           ($4, 'Popular test summit', 'popular test summit',
            ARRAY['summit']::destination_feature[], 10, 25, 'US'),
           ($5, 'Listed catalog error', 'listed catalog error',
            ARRAY[]::destination_feature[], 10, 0, 'US'),
           ($6, 'Invalid-country summit', 'invalid-country summit',
            ARRAY['summit']::destination_feature[], 10, 0, NULL)`,
        [
          listedDestination,
          userListDestination,
          ultraDestination,
          popularDestination,
          missingFeatureDestination,
          invalidCountryDestination,
        ]
      );
      await pool.query(
        `INSERT INTO lists (id, name, owner) VALUES
           ($1, $4, 'peaks'),
           ($2, $5, 'peaks'),
           ($3, $6, 'user-test')`,
        [
          peaksListA,
          peaksListB,
          userList,
          peaksListNameA,
          peaksListNameB,
          userListName,
        ]
      );
      await pool.query(
        `INSERT INTO list_destinations (list_id, destination_id) VALUES
           ($1, $4),
           ($2, $4),
           ($3, $4),
           ($3, $5),
           ($1, $6),
           ($1, $7)`,
        [
          peaksListA,
          peaksListB,
          userList,
          listedDestination,
          userListDestination,
          missingFeatureDestination,
          invalidCountryDestination,
        ]
      );

      const seeded = command("seed", "--popularity-threshold", "25", "--apply");
      assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
      const seededAgain = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(seededAgain.status, 0, seededAgain.stderr || seededAgain.stdout);

      const jobs = await pool.query<TargetJob>(
        `SELECT destination_id, state, target_reasons, published_route_id,
                blocker_code
         FROM standard_route_backfill_jobs
         WHERE destination_id = ANY($1::text[])
         ORDER BY destination_id`,
        [destinationIds]
      );
      const byDestination = new Map(
        jobs.rows.map((row) => [row.destination_id, row])
      );

      assert.equal(byDestination.has(userListDestination), false);
      assert.deepEqual(byDestination.get(listedDestination)?.target_reasons, {
        ultra_prominent: false,
        target_list: true,
        summit_feature_valid: true,
        country_code_valid: true,
        high_popularity: false,
        list_names: [peaksListNameA, peaksListNameB],
        session_count: 0,
        success_count: 0,
        popularity_threshold: 25,
        integrity_repair: false,
        repair_route_id: null,
        reason: null,
        gap_meters: null,
      });
      assert.equal(
        byDestination
          .get(listedDestination)
          ?.target_reasons.list_names.includes(userListName),
        false
      );
      assert.deepEqual(
        {
          blocker_code: byDestination.get(missingFeatureDestination)?.blocker_code,
          published_route_id:
            byDestination.get(missingFeatureDestination)?.published_route_id,
          state: byDestination.get(missingFeatureDestination)?.state,
          summit_feature_valid:
            byDestination.get(missingFeatureDestination)?.target_reasons
              .summit_feature_valid,
          target_list:
            byDestination.get(missingFeatureDestination)?.target_reasons.target_list,
        },
        {
          blocker_code: "listed_destination_missing_summit_feature",
          published_route_id: null,
          state: "needs_human",
          summit_feature_valid: false,
          target_list: true,
        }
      );
      assert.deepEqual(
        {
          blocker_code:
            byDestination.get(invalidCountryDestination)?.blocker_code,
          country_code_valid:
            byDestination.get(invalidCountryDestination)?.target_reasons
              .country_code_valid,
          published_route_id:
            byDestination.get(invalidCountryDestination)?.published_route_id,
          state: byDestination.get(invalidCountryDestination)?.state,
        },
        {
          blocker_code: "route_target_invalid_country_code",
          country_code_valid: false,
          published_route_id: null,
          state: "needs_human",
        }
      );
      assert.deepEqual(
        {
          target_list:
            byDestination.get(ultraDestination)?.target_reasons.target_list,
          ultra_prominent:
            byDestination.get(ultraDestination)?.target_reasons.ultra_prominent,
          high_popularity:
            byDestination.get(ultraDestination)?.target_reasons.high_popularity,
        },
        {
          target_list: false,
          ultra_prominent: true,
          high_popularity: false,
        }
      );
      assert.deepEqual(
        {
          target_list:
            byDestination.get(popularDestination)?.target_reasons.target_list,
          ultra_prominent:
            byDestination.get(popularDestination)?.target_reasons.ultra_prominent,
          high_popularity:
            byDestination.get(popularDestination)?.target_reasons.high_popularity,
        },
        {
          target_list: false,
          ultra_prominent: false,
          high_popularity: true,
        }
      );

      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'verified', published_route_id = NULL
         WHERE destination_id = $1`,
        [listedDestination]
      );
      await pool.query(
        `INSERT INTO destinations (
           id, name, search_name, features, prominence, session_count_offset
         ) VALUES (
           $1, 'New unseeded list summit', 'new unseeded list summit',
           ARRAY['summit']::destination_feature[], 10, 0
         )`,
        [unseededDestination]
      );
      await pool.query(
        `INSERT INTO list_destinations (list_id, destination_id)
         VALUES ($1, $2)`,
        [peaksListA, unseededDestination]
      );

      const statsResult = command("stats");
      assert.equal(statsResult.status, 0, statsResult.stderr || statsResult.stdout);
      const stats = JSON.parse(statsResult.stdout) as {
        coverage_percent: number;
        invalid_verified: number;
        remaining: number;
        states: Record<string, number>;
        unseeded: number;
      };
      assert.ok(stats.unseeded >= 1);
      assert.ok(stats.invalid_verified >= 1);
      assert.ok(stats.remaining >= 2);
      assert.ok(stats.coverage_percent < 100);
      assert.ok(stats.states.unseeded >= 1);
    } finally {
      await pool.query(
        `DELETE FROM standard_route_backfill_jobs
         WHERE destination_id = ANY($1::text[])`,
        [destinationIds]
      );
      await pool.query(
        `DELETE FROM lists WHERE id = ANY($1::text[])`,
        [[peaksListA, peaksListB, userList]]
      );
      await pool.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [destinationIds]
      );
      await pool.end();
    }
  }
);

test(
  "repeat seed promotes a stale queued job when a valid active route now exists",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "route target tests require a disposable *_test database"
    );

    const suffix = `${process.pid}-${Date.now()}`;
    const listId = `route-target-promotion-list-${suffix}`;
    const summitId = `route-target-promotion-summit-${suffix}`;
    const trailheadId = `route-target-promotion-trailhead-${suffix}`;
    const routeId = `route-target-promotion-route-${suffix}`;
    const pendingRouteId = `route-target-promotion-pending-${suffix}`;
    const segmentId = `route-target-promotion-segment-${suffix}`;
    const path =
      "SRID=4326;LINESTRING Z (-121 47 100, -121.00005 47.00005 500, -121.0001 47.0001 1000)";
    const provenance = JSON.stringify({
      source_kind: "test",
      source_url: "https://example.test/source",
      license_name: "Test license",
      license_url: "https://example.test/license",
      attribution: "Test",
      retrieved_at: "2026-08-27T00:00:00Z",
      osm_way_ids: [],
      osm_way_urls: [],
      contains_osm_geometry: false,
    });
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const command = (...args: string[]) =>
      spawnSync(
        join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
        [join(MIGRATE_ROOT, "src/standard-route-jobs.ts"), ...args],
        {
          cwd: MIGRATE_ROOT,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            DB_HOST: databaseUrl.hostname,
            DB_PORT: databaseUrl.port || "5432",
            DB_NAME: databaseUrl.pathname.slice(1),
            DB_USER: decodeURIComponent(databaseUrl.username),
            DB_PASS: decodeURIComponent(databaseUrl.password),
          },
        }
      );

    try {
      await pool.query(
        `INSERT INTO destinations (
           id, name, search_name, features, location, prominence,
           session_count_offset, country_code
         ) VALUES
           ($1, 'Promotion test summit', 'promotion test summit',
            ARRAY['summit']::destination_feature[],
            ST_GeogFromText('SRID=4326;POINT Z (-121.0001 47.0001 1000)'),
            10, 0, 'US'),
           ($2, 'Promotion test trailhead', 'promotion test trailhead',
            ARRAY['trailhead']::destination_feature[],
            ST_GeogFromText('SRID=4326;POINT Z (-121 47 100)'),
            0, 0, 'US')`,
        [summitId, trailheadId]
      );
      await pool.query(
        `UPDATE destinations
         SET hero_image = 'https://upload.wikimedia.org/route-target.jpg',
             hero_image_attribution = 'Route Target Photographer',
             hero_image_attribution_url =
               'https://commons.wikimedia.org/wiki/File:Route_target.jpg'
         WHERE id = $1`,
        [summitId]
      );
      await pool.query(
        `INSERT INTO lists (id, name, owner)
         VALUES ($1, 'Promotion test list', 'peaks')`,
        [listId]
      );
      await pool.query(
        `INSERT INTO list_destinations (list_id, destination_id)
         VALUES ($1, $2)`,
        [listId, summitId]
      );

      const firstSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(firstSeed.status, 0, firstSeed.stderr || firstSeed.stdout);
      assert.equal(
        (
          await pool.query<{ state: string }>(
            `SELECT state
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0]?.state,
        "queued"
      );

      await pool.query(
        `INSERT INTO routes (
           id, name, owner, status, shape, path, provenance,
           elevation_string, gain, gain_loss
         ) VALUES (
           $1, 'Promotion test route', 'peaks', 'pending', 'point_to_point',
           ST_GeogFromText($2), $3::jsonb,
           encode_route_elevation_profile(ST_GeogFromText($2)),
           (SELECT gain FROM route_elevation_stats(ST_GeogFromText($2))),
           (SELECT loss FROM route_elevation_stats(ST_GeogFromText($2)))
         )`,
        [routeId, path, provenance]
      );
      await pool.query(
        `INSERT INTO segments (id, path, gain, gain_loss, provenance)
         VALUES (
           $1, ST_GeogFromText($2),
           (SELECT gain FROM route_elevation_stats(ST_GeogFromText($2))),
           (SELECT loss FROM route_elevation_stats(ST_GeogFromText($2))),
           $3::jsonb
         )`,
        [segmentId, path, provenance]
      );
      await pool.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0), ($1, $3, 1)`,
        [routeId, trailheadId, summitId]
      );
      await pool.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
         VALUES ($1, $2, 0, 'forward')`,
        [routeId, segmentId]
      );
      await pool.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [routeId]
      );
      assert.equal(
        (
          await pool.query<{ valid: boolean }>(
            `SELECT peaks_route_passes_publish_integrity(
               $1, $2, 'active'
             ) AS valid`,
            [routeId, summitId]
          )
        ).rows[0]?.valid,
        true
      );

      await pool.query(
        `INSERT INTO routes (
           id, name, owner, status, shape, path, provenance,
           elevation_string, gain, gain_loss
         ) VALUES (
           $1, 'Blocked review route', 'peaks', 'pending', 'point_to_point',
           ST_GeogFromText($2), $3::jsonb,
           encode_route_elevation_profile(ST_GeogFromText($2)),
           (SELECT gain FROM route_elevation_stats(ST_GeogFromText($2))),
           (SELECT loss FROM route_elevation_stats(ST_GeogFromText($2)))
         )`,
        [pendingRouteId, path, provenance]
      );
      await pool.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0), ($1, $3, 1)`,
        [pendingRouteId, trailheadId, summitId]
      );
      await pool.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
         VALUES ($1, $2, 0, 'forward')`,
        [pendingRouteId, segmentId]
      );
      for (const state of ["waiting_rights", "waiting_access"]) {
        await pool.query(
          `UPDATE standard_route_backfill_jobs
           SET state = $2::text,
               evidence = jsonb_build_object('state', $2::text),
               candidate = jsonb_build_object('state', $2::text),
               review = jsonb_build_object('state', $2::text),
               candidate_path = '/tmp/blocked-review.json',
               candidate_sha256 = repeat('c', 64),
               candidate_artifact = jsonb_build_object('state', $2::text),
               trailhead_id = $4,
               published_route_id = $3,
               replacement_route_id = $5,
               blocker_code = $2::text,
               blocker_message = 'Preserve reviewed blocker',
               last_error = 'preserve reviewed error',
               next_attempt_at = now() + interval '1 day',
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL
           WHERE destination_id = $1`,
          [summitId, state, pendingRouteId, trailheadId, routeId]
        );
        const blockedSeed = command(
          "seed",
          "--popularity-threshold",
          "25",
          "--apply"
        );
        assert.equal(
          blockedSeed.status,
          0,
          blockedSeed.stderr || blockedSeed.stdout
        );
        const blocked = (
          await pool.query<{
            blocker_code: string | null;
            candidate: unknown;
            candidate_artifact: unknown;
            evidence: unknown;
            published_route_id: string | null;
            replacement_route_id: string | null;
            review: unknown;
            state: string;
            trailhead_id: string | null;
          }>(
            `SELECT state, evidence, candidate, review, candidate_artifact,
                    trailhead_id, published_route_id, replacement_route_id,
                    blocker_code
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0];
        assert.deepEqual(blocked, {
          blocker_code: state,
          candidate: { state },
          candidate_artifact: { state },
          evidence: { state },
          published_route_id: pendingRouteId,
          replacement_route_id: routeId,
          review: { state },
          state,
          trailhead_id: trailheadId,
        });

        await pool.query(
          `UPDATE destinations SET country_code = NULL WHERE id = $1`,
          [summitId]
        );
        const invalidCountrySeed = command(
          "seed",
          "--popularity-threshold",
          "25",
          "--apply"
        );
        assert.equal(
          invalidCountrySeed.status,
          0,
          invalidCountrySeed.stderr || invalidCountrySeed.stdout
        );
        const countryBlocked = (
          await pool.query<{
            blocker_code: string | null;
            candidate: unknown;
            candidate_artifact: unknown;
            candidate_path: string | null;
            candidate_sha256: string | null;
            country_code_valid: boolean;
            evidence: unknown;
            published_route_id: string | null;
            replacement_route_id: string | null;
            review: unknown;
            state: string;
            trailhead_id: string | null;
          }>(
            `SELECT state,
                    (target_reasons->>'country_code_valid')::boolean
                      AS country_code_valid,
                    evidence, candidate, review,
                    candidate_path, candidate_sha256, candidate_artifact,
                    trailhead_id, published_route_id, replacement_route_id,
                    blocker_code
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0];
        assert.deepEqual(countryBlocked, {
          blocker_code: "route_target_invalid_country_code",
          candidate: { state },
          candidate_artifact: { state },
          candidate_path: "/tmp/blocked-review.json",
          candidate_sha256: "c".repeat(64),
          country_code_valid: false,
          evidence: { state },
          published_route_id: pendingRouteId,
          replacement_route_id: routeId,
          review: { state },
          state: "needs_human",
          trailhead_id: trailheadId,
        });
        await pool.query(
          `UPDATE destinations SET country_code = 'US' WHERE id = $1`,
          [summitId]
        );
      }

      await pool.query(
        `UPDATE destinations SET country_code = NULL WHERE id = $1`,
        [summitId]
      );
      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'researching',
             blocker_code = 'live_worker_blocker',
             blocker_message = 'Keep the live worker state',
             last_error = 'keep live error',
             lease_owner = 'live-worker',
             lease_token = 'live-token',
             lease_expires_at = now() + interval '1 day'
         WHERE destination_id = $1`,
        [summitId]
      );
      const liveLeaseSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        liveLeaseSeed.status,
        0,
        liveLeaseSeed.stderr || liveLeaseSeed.stdout
      );
      assert.deepEqual(
        (
          await pool.query<{
            blocker_code: string | null;
            lease_owner: string | null;
            lease_token: string | null;
            state: string;
          }>(
            `SELECT state, blocker_code, lease_owner, lease_token
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0],
        {
          blocker_code: "live_worker_blocker",
          lease_owner: "live-worker",
          lease_token: "live-token",
          state: "researching",
        }
      );

      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET lease_expires_at = now() - interval '1 minute'
         WHERE destination_id = $1`,
        [summitId]
      );
      const expiredLeaseSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        expiredLeaseSeed.status,
        0,
        expiredLeaseSeed.stderr || expiredLeaseSeed.stdout
      );
      assert.deepEqual(
        (
          await pool.query<{
            blocker_code: string | null;
            candidate: unknown;
            lease_expires_at: Date | null;
            lease_owner: string | null;
            lease_token: string | null;
            published_route_id: string | null;
            state: string;
          }>(
            `SELECT state, blocker_code, candidate, published_route_id,
                    lease_owner, lease_token, lease_expires_at
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0],
        {
          blocker_code: "route_target_invalid_country_code",
          candidate: { state: "waiting_access" },
          lease_expires_at: null,
          lease_owner: null,
          lease_token: null,
          published_route_id: pendingRouteId,
          state: "needs_human",
        }
      );
      await pool.query(
        `UPDATE destinations SET country_code = 'US' WHERE id = $1`,
        [summitId]
      );
      const repairedCountrySeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        repairedCountrySeed.status,
        0,
        repairedCountrySeed.stderr || repairedCountrySeed.stdout
      );
      assert.deepEqual(
        (
          await pool.query<{
            blocker_code: string | null;
            candidate: unknown;
            candidate_artifact: unknown;
            published_route_id: string | null;
            state: string;
          }>(
            `SELECT state, blocker_code, candidate, candidate_artifact,
                    published_route_id
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0],
        {
          blocker_code: null,
          candidate: { official_source_country_code: "US" },
          candidate_artifact: null,
          published_route_id: routeId,
          state: "published",
        }
      );

      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'queued',
             evidence = '{"stale":true}',
             candidate = '{"stale":true}',
             review = '{"stale":true}',
             candidate_path = '/tmp/stale-route.json',
             candidate_sha256 = repeat('a', 64),
             candidate_artifact = '{"stale":true}',
             published_route_id = NULL,
             replacement_route_id = $2,
             blocker_code = 'stale_blocker',
             blocker_message = 'Stale blocker',
             last_error = 'stale error',
             next_attempt_at = now() + interval '1 day',
             lease_owner = 'stale-worker',
             lease_token = 'stale-token',
             lease_expires_at = now() - interval '1 minute'
         WHERE destination_id = $1`,
        [summitId, routeId]
      );

      const secondSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(secondSeed.status, 0, secondSeed.stderr || secondSeed.stdout);

      const promoted = (
        await pool.query<{
          blocker_code: string | null;
          blocker_message: string | null;
          candidate: unknown;
          candidate_artifact: unknown;
          candidate_path: string | null;
          candidate_sha256: string | null;
          evidence: unknown;
          last_error: string | null;
          lease_expires_at: Date | null;
          lease_owner: string | null;
          lease_token: string | null;
          next_attempt_ready: boolean;
          published_route_id: string | null;
          replacement_route_id: string | null;
          review: unknown;
          state: string;
          trailhead_id: string | null;
        }>(
          `SELECT state, trailhead_id, published_route_id,
                  replacement_route_id, blocker_code, blocker_message,
                  evidence, candidate, review, candidate_path,
                  candidate_sha256, candidate_artifact, last_error,
                  lease_owner, lease_token, lease_expires_at,
                  next_attempt_at <= now() AS next_attempt_ready
           FROM standard_route_backfill_jobs
           WHERE destination_id = $1`,
          [summitId]
        )
      ).rows[0];
      assert.deepEqual(promoted, {
        blocker_code: null,
        blocker_message: null,
        candidate: { official_source_country_code: "US" },
        candidate_artifact: null,
        candidate_path: null,
        candidate_sha256: null,
        evidence: {},
        last_error: null,
        lease_expires_at: null,
        lease_owner: null,
        lease_token: null,
        next_attempt_ready: true,
        published_route_id: routeId,
        replacement_route_id: null,
        review: {},
        state: "published",
        trailhead_id: trailheadId,
      });

      await pool.query(
        `UPDATE destinations SET country_code = 'CA' WHERE id = $1`,
        [summitId]
      );
      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'published',
             target_reasons = target_reasons
               - 'country_binding_research_required'
               - 'country_binding_reset_required'
               - 'country_binding_target_country_code'
               - 'country_binding_route_id'
               - 'prior_official_source_country_code',
             evidence = '{"live_lease":"preserve"}'::jsonb,
             candidate = '{"official_source_country_code":"US","state":"published"}'::jsonb,
             review = '{"approved_under_country":"US"}'::jsonb,
             candidate_path = '/tmp/live-published-us.geojson',
             candidate_sha256 = repeat('b', 64),
             candidate_artifact = '{"country":"US"}'::jsonb,
             trailhead_id = $2,
             published_route_id = $3,
             replacement_route_id = NULL,
             blocker_code = 'live_publish_blocker',
             blocker_message = 'Keep live publish binding',
             last_error = 'keep live publish error',
             next_attempt_at = now() + interval '1 day',
             lease_owner = 'live-publish-worker',
             lease_token = 'live-publish-token',
             lease_expires_at = now() + interval '1 day'
         WHERE destination_id = $1`,
        [summitId, trailheadId, routeId]
      );
      const livePublishedDriftSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        livePublishedDriftSeed.status,
        0,
        livePublishedDriftSeed.stderr || livePublishedDriftSeed.stdout
      );
      assert.deepEqual(
        (
          await pool.query<{
            blocker_code: string | null;
            candidate: unknown;
            candidate_artifact: unknown;
            candidate_path: string | null;
            candidate_sha256: string | null;
            evidence: unknown;
            lease_owner: string | null;
            lease_token: string | null;
            published_route_id: string | null;
            review: unknown;
            state: string;
          }>(
            `SELECT state, evidence, candidate, review, candidate_path,
                    candidate_sha256, candidate_artifact, published_route_id,
                    blocker_code, lease_owner, lease_token
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0],
        {
          blocker_code: "live_publish_blocker",
          candidate: {
            official_source_country_code: "US",
            state: "published",
          },
          candidate_artifact: { country: "US" },
          candidate_path: "/tmp/live-published-us.geojson",
          candidate_sha256: "b".repeat(64),
          evidence: { live_lease: "preserve" },
          lease_owner: "live-publish-worker",
          lease_token: "live-publish-token",
          published_route_id: routeId,
          review: { approved_under_country: "US" },
          state: "published",
        },
        "seed must not alter a live published verification lease"
      );

      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET lease_expires_at = now() - interval '1 minute'
         WHERE destination_id = $1`,
        [summitId]
      );
      const expiredPublishedDriftSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        expiredPublishedDriftSeed.status,
        0,
        expiredPublishedDriftSeed.stderr || expiredPublishedDriftSeed.stdout
      );
      const publishedRecovery = (
        await pool.query<{
          blocker_code: string | null;
          candidate: unknown;
          candidate_artifact: unknown;
          candidate_path: string | null;
          candidate_sha256: string | null;
          country_binding_research_required: boolean;
          country_binding_reset_required: boolean;
          country_binding_target_country_code: string | null;
          evidence: unknown;
          factory_claimable: boolean;
          lease_owner: string | null;
          lease_token: string | null;
          published_route_id: string | null;
          replacement_route_id: string | null;
          review: unknown;
          state: string;
        }>(
          `SELECT state, evidence, candidate, review, candidate_path,
                  candidate_sha256, candidate_artifact, published_route_id,
                  replacement_route_id, blocker_code, lease_owner, lease_token,
                  (target_reasons->>'country_binding_research_required')::boolean
                    AS country_binding_research_required,
                  (target_reasons->>'country_binding_reset_required')::boolean
                    AS country_binding_reset_required,
                  target_reasons->>'country_binding_target_country_code'
                    AS country_binding_target_country_code,
                  state = 'queued'
                    AND next_attempt_at <= now()
                    AND lease_token IS NULL
                    AND lease_expires_at IS NULL
                    AS factory_claimable
           FROM standard_route_backfill_jobs
           WHERE destination_id = $1`,
          [summitId]
        )
      ).rows[0];
      assert.deepEqual(publishedRecovery, {
        blocker_code: "route_target_country_binding_drift",
        candidate: {},
        candidate_artifact: null,
        candidate_path: null,
        candidate_sha256: null,
        country_binding_research_required: true,
        country_binding_reset_required: true,
        country_binding_target_country_code: "CA",
        evidence: { live_lease: "preserve" },
        factory_claimable: true,
        lease_owner: null,
        lease_token: null,
        published_route_id: routeId,
        replacement_route_id: routeId,
        review: {},
        state: "queued",
      });

      for (const staleState of [
        "candidate_ready",
        "pending_review",
        "approved",
        "needs_revision",
      ]) {
        const stalePendingRouteId =
          staleState === "candidate_ready" ? null : pendingRouteId;
        await pool.query(
          `UPDATE standard_route_backfill_jobs
           SET state = $2,
               target_reasons = target_reasons
                 - 'country_binding_research_required'
                 - 'country_binding_reset_required'
                 - 'country_binding_target_country_code'
                 - 'country_binding_route_id'
                 - 'prior_official_source_country_code',
               evidence = jsonb_build_object('preserved_state', $2::text),
               candidate = jsonb_build_object(
                 'official_source_country_code', 'US',
                 'stale_state', $2::text
               ),
               review = jsonb_build_object('stale_state', $2::text),
               candidate_path = '/tmp/stale-country-candidate.geojson',
               candidate_sha256 = repeat('e', 64),
               candidate_artifact = jsonb_build_object(
                 'stale_state', $2::text
               ),
               trailhead_id = $3,
               published_route_id = $4,
               replacement_route_id = $5,
               blocker_code = 'stale_country_binding',
               blocker_message = 'Stale country binding',
               last_error = 'stale country error',
               next_attempt_at = now() + interval '1 day',
               lease_owner = 'expired-country-worker',
               lease_token = 'expired-country-token',
               lease_expires_at = now() - interval '1 minute'
           WHERE destination_id = $1`,
          [
            summitId,
            staleState,
            trailheadId,
            stalePendingRouteId,
            routeId,
          ]
        );
        const staleStateSeed = command(
          "seed",
          "--popularity-threshold",
          "25",
          "--apply"
        );
        assert.equal(
          staleStateSeed.status,
          0,
          staleStateSeed.stderr || staleStateSeed.stdout
        );
        assert.deepEqual(
          (
            await pool.query<{
              blocker_code: string | null;
              candidate: unknown;
              candidate_artifact: unknown;
              candidate_path: string | null;
              candidate_sha256: string | null;
              country_binding_research_required: boolean;
              country_binding_reset_required: boolean;
              evidence: unknown;
              lease_owner: string | null;
              lease_token: string | null;
              published_route_id: string | null;
              replacement_route_id: string | null;
              review: unknown;
              state: string;
            }>(
              `SELECT state, evidence, candidate, review, candidate_path,
                      candidate_sha256, candidate_artifact,
                      published_route_id, replacement_route_id, blocker_code,
                      lease_owner, lease_token,
                      (target_reasons
                        ->>'country_binding_research_required')::boolean
                        AS country_binding_research_required,
                      (target_reasons
                        ->>'country_binding_reset_required')::boolean
                        AS country_binding_reset_required
               FROM standard_route_backfill_jobs
               WHERE destination_id = $1`,
              [summitId]
            )
          ).rows[0],
          {
            blocker_code: "route_target_country_binding_drift",
            candidate: {},
            candidate_artifact: null,
            candidate_path: null,
            candidate_sha256: null,
            country_binding_research_required: true,
            country_binding_reset_required: true,
            evidence: { preserved_state: staleState },
            lease_owner: null,
            lease_token: null,
            published_route_id: stalePendingRouteId,
            replacement_route_id: routeId,
            review: {},
            state: "queued",
          },
          `${staleState} country drift must reset to fresh research`
        );
      }

      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'candidate_ready',
             candidate = '{"official_source_country_code":"CA","fresh":true}'::jsonb,
             review = '{}'::jsonb,
             candidate_path = '/tmp/fresh-ca-candidate.geojson',
             candidate_sha256 = repeat('f', 64),
             candidate_artifact = '{"country":"CA"}'::jsonb,
             published_route_id = $2,
             replacement_route_id = $3,
             blocker_code = 'route_target_country_binding_drift',
             blocker_message = 'Research is fresh; review is still required',
             last_error = NULL,
             next_attempt_at = now(),
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE destination_id = $1`,
        [summitId, pendingRouteId, routeId]
      );
      const freshCandidateSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        freshCandidateSeed.status,
        0,
        freshCandidateSeed.stderr || freshCandidateSeed.stdout
      );
      assert.deepEqual(
        (
          await pool.query<{
            candidate: unknown;
            candidate_artifact: unknown;
            country_binding_research_required: boolean;
            country_binding_reset_required: boolean;
            published_route_id: string | null;
            replacement_route_id: string | null;
            state: string;
          }>(
            `SELECT state, candidate, candidate_artifact,
                    published_route_id, replacement_route_id,
                    (target_reasons
                      ->>'country_binding_research_required')::boolean
                      AS country_binding_research_required,
                    (target_reasons
                      ->>'country_binding_reset_required')::boolean
                      AS country_binding_reset_required
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0],
        {
          candidate: {
            fresh: true,
            official_source_country_code: "CA",
          },
          candidate_artifact: { country: "CA" },
          country_binding_research_required: true,
          country_binding_reset_required: false,
          published_route_id: pendingRouteId,
          replacement_route_id: routeId,
          state: "candidate_ready",
        },
        "repeat seed must preserve a freshly rebound candidate and its pending cleanup target"
      );
      assert.equal(
        (
          await pool.query<{ status: string }>(
            `SELECT status FROM routes WHERE id = $1`,
            [pendingRouteId]
          )
        ).rows[0]?.status,
        "pending",
        "the next import transaction must remain responsible for pending-route cleanup"
      );

      await pool.query(
        `UPDATE destinations SET country_code = 'US' WHERE id = $1`,
        [summitId]
      );
      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'verified',
             target_reasons = target_reasons
               - 'country_binding_research_required'
               - 'country_binding_reset_required'
               - 'country_binding_target_country_code'
               - 'country_binding_route_id'
               - 'prior_official_source_country_code',
             evidence = '{"reviewed_under_country":"US"}'::jsonb,
             candidate = '{"official_source_country_code":"US","route_name":"Old US candidate"}'::jsonb,
             review = '{"approved_under_country":"US"}'::jsonb,
             candidate_path = '/tmp/old-us-candidate.geojson',
             candidate_sha256 = repeat('d', 64),
             candidate_artifact = '{"country":"US"}'::jsonb,
             published_route_id = $2,
             replacement_route_id = NULL,
             blocker_code = NULL,
             blocker_message = NULL,
             last_error = NULL,
             next_attempt_at = now(),
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE destination_id = $1`,
        [summitId, routeId]
      );
      const statsBeforeDriftResult = command("stats");
      assert.equal(
        statsBeforeDriftResult.status,
        0,
        statsBeforeDriftResult.stderr || statsBeforeDriftResult.stdout
      );
      const statsBeforeDrift = JSON.parse(statsBeforeDriftResult.stdout) as {
        invalid_verified: number;
        verified: number;
      };

      await pool.query(
        `UPDATE destinations SET country_code = 'CA' WHERE id = $1`,
        [summitId]
      );
      const statsAfterDriftResult = command("stats");
      assert.equal(
        statsAfterDriftResult.status,
        0,
        statsAfterDriftResult.stderr || statsAfterDriftResult.stdout
      );
      const statsAfterDrift = JSON.parse(statsAfterDriftResult.stdout) as {
        invalid_verified: number;
        verified: number;
      };
      assert.equal(
        statsAfterDrift.verified,
        statsBeforeDrift.verified - 1
      );
      assert.equal(
        statsAfterDrift.invalid_verified,
        statsBeforeDrift.invalid_verified + 1
      );

      const countryDriftSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        countryDriftSeed.status,
        0,
        countryDriftSeed.stderr || countryDriftSeed.stdout
      );
      const countryDriftRecovery = (
        await pool.query<{
          blocker_code: string | null;
          candidate: unknown;
          candidate_artifact: unknown;
          candidate_path: string | null;
          candidate_sha256: string | null;
          country_binding_research_required: boolean;
          country_binding_route_id: string | null;
          evidence: unknown;
          factory_claimable: boolean;
          published_route_id: string | null;
          replacement_route_id: string | null;
          review: unknown;
          state: string;
        }>(
          `SELECT state, candidate, review, candidate_path,
                  candidate_sha256, candidate_artifact, evidence,
                  published_route_id, replacement_route_id, blocker_code,
                  (target_reasons->>'country_binding_research_required')::boolean
                    AS country_binding_research_required,
                  target_reasons->>'country_binding_route_id'
                    AS country_binding_route_id,
                  state = 'queued'
                    AND next_attempt_at <= now()
                    AND lease_token IS NULL
                    AND lease_expires_at IS NULL
                    AS factory_claimable
           FROM standard_route_backfill_jobs
           WHERE destination_id = $1`,
          [summitId]
        )
      ).rows[0];
      assert.deepEqual(countryDriftRecovery, {
        blocker_code: "route_target_country_binding_drift",
        candidate: {},
        candidate_artifact: null,
        candidate_path: null,
        candidate_sha256: null,
        country_binding_research_required: true,
        country_binding_route_id: routeId,
        evidence: { reviewed_under_country: "US" },
        factory_claimable: true,
        published_route_id: routeId,
        replacement_route_id: routeId,
        review: {},
        state: "queued",
      });

      const repeatedCountryDriftSeed = command(
        "seed",
        "--popularity-threshold",
        "25",
        "--apply"
      );
      assert.equal(
        repeatedCountryDriftSeed.status,
        0,
        repeatedCountryDriftSeed.stderr || repeatedCountryDriftSeed.stdout
      );
      assert.deepEqual(
        (
          await pool.query<{
            candidate: unknown;
            country_binding_research_required: boolean;
            replacement_route_id: string | null;
            state: string;
          }>(
            `SELECT state, candidate, replacement_route_id,
                    (target_reasons->>'country_binding_research_required')::boolean
                      AS country_binding_research_required
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0],
        {
          candidate: {},
          country_binding_research_required: true,
          replacement_route_id: routeId,
          state: "queued",
        },
        "repeat seed must not relabel the old route for the new country"
      );

      await pool.query(
        `UPDATE destinations SET country_code = 'US' WHERE id = $1`,
        [summitId]
      );
      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'verified',
             candidate = '{"official_source_country_code":"US"}'::jsonb,
             target_reasons = target_reasons
               - 'country_binding_research_required'
               - 'country_binding_reset_required'
               - 'country_binding_target_country_code'
               - 'country_binding_route_id'
               - 'prior_official_source_country_code',
             replacement_route_id = NULL,
             blocker_code = NULL,
             blocker_message = NULL
         WHERE destination_id = $1`,
        [summitId]
      );
      await pool.query(
        `UPDATE destinations
         SET location = ST_GeogFromText(
           'SRID=4326;POINT Z (-121.01 47.01 100)'
         )
         WHERE id = $1`,
        [trailheadId]
      );
      const statsAfterTrailheadDriftResult = command("stats");
      assert.equal(
        statsAfterTrailheadDriftResult.status,
        0,
        statsAfterTrailheadDriftResult.stderr ||
          statsAfterTrailheadDriftResult.stdout
      );
      const statsAfterTrailheadDrift = JSON.parse(
        statsAfterTrailheadDriftResult.stdout
      ) as {
        invalid_verified: number;
        verified: number;
      };
      assert.equal(
        statsAfterTrailheadDrift.verified,
        statsBeforeDrift.verified - 1
      );
      assert.equal(
        statsAfterTrailheadDrift.invalid_verified,
        statsBeforeDrift.invalid_verified + 1
      );
    } finally {
      await pool.query(
        `DELETE FROM standard_route_backfill_jobs WHERE destination_id = $1`,
        [summitId]
      );
      await pool.query(
        `DELETE FROM routes WHERE id = ANY($1::text[])`,
        [[routeId, pendingRouteId]]
      );
      await pool.query(`DELETE FROM segments WHERE id = $1`, [segmentId]);
      await pool.query(`DELETE FROM lists WHERE id = $1`, [listId]);
      await pool.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[summitId, trailheadId]]
      );
      await pool.end();
    }
  }
);
