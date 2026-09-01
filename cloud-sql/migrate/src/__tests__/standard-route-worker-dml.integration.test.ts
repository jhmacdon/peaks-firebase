import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const OPERATOR_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const FACTORY_DATABASE_URL = process.env.ROUTE_JOB_FACTORY_TEST_DATABASE_URL;
const REVIEWER_DATABASE_URL = process.env.ROUTE_JOB_REVIEWER_TEST_DATABASE_URL;

function requireDisposableDatabase(value: string, label: string): URL {
  const url = new URL(value);
  assert.match(
    url.pathname,
    /_test$/,
    `${label} must use a disposable *_test database`
  );
  return url;
}

test(
  "route worker database roles cannot bypass review or mutate live routes",
  {
    skip:
      OPERATOR_DATABASE_URL && FACTORY_DATABASE_URL && REVIEWER_DATABASE_URL
        ? false
        : "operator, factory, and reviewer route-job test database URLs are required",
  },
  async () => {
    const operatorUrl = requireDisposableDatabase(
      OPERATOR_DATABASE_URL!,
      "operator URL"
    );
    const factoryUrl = requireDisposableDatabase(
      FACTORY_DATABASE_URL!,
      "factory URL"
    );
    const reviewerUrl = requireDisposableDatabase(
      REVIEWER_DATABASE_URL!,
      "reviewer URL"
    );
    assert.equal(factoryUrl.pathname, operatorUrl.pathname);
    assert.equal(reviewerUrl.pathname, operatorUrl.pathname);

    const suffix = `${process.pid}-${Date.now()}`;
    const destinationId = `route-worker-dml-destination-${suffix}`;
    const reviewDestinationId = `route-worker-dml-review-destination-${suffix}`;
    const retargetDestinationId = `route-worker-dml-retarget-destination-${suffix}`;
    const pendingRouteId = `route-worker-dml-pending-${suffix}`;
    const activeRouteId = `route-worker-dml-active-${suffix}`;
    const shadowVictimRouteId = `route-worker-dml-shadow-victim-${suffix}`;
    const orphanRouteId = `route-worker-dml-orphan-${suffix}`;
    const segmentId = `route-worker-dml-segment-${suffix}`;
    const operator = new Pool({ connectionString: OPERATOR_DATABASE_URL });
    const factory = new Pool({ connectionString: FACTORY_DATABASE_URL });
    const reviewer = new Pool({ connectionString: REVIEWER_DATABASE_URL });

    try {
      for (const [lane, worker] of [
        ["factory", factory],
        ["reviewer", reviewer],
      ] as const) {
        const staleDml = await worker.query<{
          table_name: string;
          privilege: string;
        }>(
          `SELECT table_name, privilege
           FROM (VALUES ('destinations'), ('route_areas')) AS tables(table_name)
           CROSS JOIN (
             VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
           ) AS privileges(privilege)
           WHERE has_table_privilege(
             session_user,
             format('public.%I', table_name),
             privilege
           )
           ORDER BY table_name, privilege`
        );
        assert.deepEqual(
          staleDml.rows,
          [],
          `${lane} credentials must not retain broad destination or route-area DML`
        );
      }

      await operator.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES
           ($1, 'Worker DML test summit', 'worker dml test summit',
            ARRAY['summit']::destination_feature[]),
           ($2, 'Worker DML review summit', 'worker dml review summit',
            ARRAY['summit']::destination_feature[]),
           ($3, 'Worker DML retarget summit', 'worker dml retarget summit',
            ARRAY['summit']::destination_feature[])`,
        [destinationId, reviewDestinationId, retargetDestinationId]
      );
      await operator.query(
        `UPDATE destinations
         SET hero_image = 'https://upload.wikimedia.org/route-worker.jpg',
             hero_image_attribution = 'Route Worker Photographer',
             hero_image_attribution_url =
               'https://commons.wikimedia.org/wiki/File:Route_worker.jpg'
         WHERE id = $1`,
        [destinationId]
      );
      await operator.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES
           ($1, 'Pending worker DML test route', 'peaks', 'pending'),
           ($2, 'Active worker DML test route', 'peaks', 'pending'),
           ($3, 'Temp-shadow victim route', 'peaks', 'pending')`,
        [pendingRouteId, activeRouteId, shadowVictimRouteId]
      );
      await operator.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [activeRouteId, destinationId]
      );
      await operator.query(
        `INSERT INTO segments (id, name)
         VALUES ($1, 'Worker DML test segment')`,
        [segmentId]
      );
      await operator.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal)
         VALUES ($1, $2, 0)`,
        [activeRouteId, segmentId]
      );
      await operator.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [activeRouteId]
      );
      await operator.query(
        `INSERT INTO standard_route_backfill_jobs (
           destination_id, state, published_route_id
         ) VALUES ($1, 'verified', $2)`,
        [destinationId, activeRouteId]
      );
      await operator.query(
        `INSERT INTO standard_route_backfill_jobs (
           destination_id, state, published_route_id,
           lease_owner, lease_token, lease_expires_at
         ) VALUES (
           $1, 'pending_review', $2,
           'luna-route-reviewer-01', $3, now() + interval '1 hour'
         )`,
        [reviewDestinationId, pendingRouteId, `review-lease-${suffix}`]
      );

      await assert.rejects(
        factory.query(
          `UPDATE standard_route_backfill_jobs
           SET destination_id = $2
           WHERE destination_id = $1`,
          [destinationId, retargetDestinationId]
        ),
        /route worker database roles cannot retarget queue jobs/
      );
      await assert.rejects(
        reviewer.query(
          `UPDATE standard_route_backfill_jobs
           SET destination_id = $2
           WHERE destination_id = $1`,
          [reviewDestinationId, retargetDestinationId]
        ),
        /route worker database roles cannot retarget queue jobs/
      );

      await assert.rejects(
        factory.query(
          `UPDATE standard_route_backfill_jobs
           SET evidence = evidence || '{"factory_tampered":true}'::jsonb
           WHERE destination_id = $1`,
          [destinationId]
        ),
        /factory database role cannot change verified jobs/
      );

      await assert.rejects(
        factory.query(
          `UPDATE routes SET status = 'active' WHERE id = $1`,
          [pendingRouteId]
        ),
        /bound activation function|cannot make this route transition/
      );
      await assert.rejects(
        factory.query(
          `UPDATE routes SET name = 'Changed by factory' WHERE id = $1`,
          [pendingRouteId]
        ),
        /permission denied/
      );
      await assert.rejects(
        factory.query(`DELETE FROM routes WHERE id = $1`, [activeRouteId]),
        /cannot delete a live route/
      );
      await assert.rejects(
        factory.query(
          `INSERT INTO routes (id, name, owner, status)
           VALUES ($1, 'Unbound worker DML route', 'peaks', 'pending')`,
          [orphanRouteId]
        ),
        /live candidate lease|one unleased pending_review binding/
      );
      await assert.rejects(
        factory.query(
          `INSERT INTO route_destinations (route_id, destination_id, ordinal)
           VALUES ($1, $2, 1)`,
          [activeRouteId, destinationId]
        ),
        /only on pending Peaks routes/
      );
      await assert.rejects(
        factory.query(
          `DELETE FROM route_segments
           WHERE route_id = $1 AND segment_id = $2`,
          [activeRouteId, segmentId]
        ),
        /only on pending Peaks routes/
      );
      await assert.rejects(
        factory.query(
          `UPDATE segments SET updated_at = now() WHERE id = $1`,
          [segmentId]
        ),
        /cannot edit segment records/
      );
      await assert.rejects(
        factory.query(
          `UPDATE destinations SET id = id WHERE id = $1`,
          [destinationId]
        ),
        /may lock but not change destinations/
      );
      await assert.rejects(
        factory.query(
          `SELECT activate_standard_route_factory($1, $2, 'forged-lease')`,
          [destinationId, pendingRouteId]
        ),
        /not bound to an approved live lease/
      );
      await assert.rejects(
        factory.query(
          `SELECT settle_route_integrity_replacement($1, $2, $3)`,
          [activeRouteId, destinationId, pendingRouteId]
        ),
        /permission denied/
      );

      await assert.rejects(
        reviewer.query(
          `UPDATE routes SET status = 'active' WHERE id = $1`,
          [pendingRouteId]
        ),
        /reviewer database role cannot write route records/
      );
      await assert.rejects(
        reviewer.query(`DELETE FROM routes WHERE id = $1`, [pendingRouteId]),
        /permission denied/
      );
      await assert.rejects(
        reviewer.query(
          `SELECT activate_standard_route_factory($1, $2, 'forged-lease')`,
          [destinationId, pendingRouteId]
        ),
        /permission denied/
      );

      const factoryLock = await factory.connect();
      try {
        await factoryLock.query("BEGIN");
        await factoryLock.query(
          `CREATE TEMP TABLE standard_route_backfill_jobs (
             destination_id text,
             state text,
             published_route_id text,
             lease_owner text,
             lease_token text,
             lease_expires_at timestamptz
           ) ON COMMIT DROP`
        );
        await factoryLock.query(
          `CREATE TEMP TABLE route_destinations (
             route_id text,
             destination_id text
           ) ON COMMIT DROP`
        );
        await factoryLock.query(
          `INSERT INTO standard_route_backfill_jobs
             (destination_id, state, published_route_id,
              lease_owner, lease_token, lease_expires_at)
           VALUES ($1, 'candidate_ready', $2, 'forged', 'forged',
                   now() + interval '1 hour')`,
          [destinationId, shadowVictimRouteId]
        );
        await factoryLock.query(
          `INSERT INTO route_destinations (route_id, destination_id)
           VALUES ($1, $2)`,
          [shadowVictimRouteId, destinationId]
        );
        await assert.rejects(
          factoryLock.query(`DELETE FROM public.routes WHERE id = $1`, [
            shadowVictimRouteId,
          ]),
          /factory route delete is not bound to its candidate lease/
        );
        await factoryLock.query("ROLLBACK");
        await factoryLock.query("BEGIN");
        const locked = await factoryLock.query(
          `SELECT id FROM public.routes WHERE id = $1 FOR UPDATE`,
          [pendingRouteId]
        );
        assert.equal(locked.rows[0]?.id, pendingRouteId);
        await factoryLock.query("ROLLBACK");
      } finally {
        factoryLock.release();
      }

      const reviewerLock = await reviewer.connect();
      try {
        await reviewerLock.query("BEGIN");
        const locked = await reviewerLock.query(
          `SELECT id FROM routes WHERE id = $1 FOR UPDATE`,
          [pendingRouteId]
        );
        assert.equal(locked.rows[0]?.id, pendingRouteId);
        await reviewerLock.query("ROLLBACK");
      } finally {
        reviewerLock.release();
      }
    } finally {
      await operator.query(
        `DELETE FROM routes WHERE id = ANY($1::text[])`,
        [[pendingRouteId, activeRouteId, shadowVictimRouteId, orphanRouteId]]
      );
      await operator.query(`DELETE FROM segments WHERE id = $1`, [segmentId]);
      await operator.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[destinationId, reviewDestinationId, retargetDestinationId]]
      );
      await operator.end();
      await factory.end();
      await reviewer.end();
    }
  }
);

test(
  "factory activation rejects stale bindings and shared-route retirement",
  {
    skip:
      OPERATOR_DATABASE_URL && FACTORY_DATABASE_URL && REVIEWER_DATABASE_URL
        ? false
        : "operator, factory, and reviewer route-job test database URLs are required",
  },
  async () => {
    const operatorUrl = requireDisposableDatabase(
      OPERATOR_DATABASE_URL!,
      "operator URL"
    );
    const factoryUrl = requireDisposableDatabase(
      FACTORY_DATABASE_URL!,
      "factory URL"
    );
    const reviewerUrl = requireDisposableDatabase(
      REVIEWER_DATABASE_URL!,
      "reviewer URL"
    );
    assert.equal(factoryUrl.pathname, operatorUrl.pathname);
    assert.equal(reviewerUrl.pathname, operatorUrl.pathname);

    const suffix = `${process.pid}-${Date.now()}`;
    const summitId = `route-worker-activation-summit-${suffix}`;
    const sharedSummitId = `route-worker-activation-shared-summit-${suffix}`;
    const trailheadId = `route-worker-activation-trailhead-${suffix}`;
    const routeId = `route-worker-activation-route-${suffix}`;
    const sharedRouteId = `route-worker-activation-shared-route-${suffix}`;
    const segmentId = `route-worker-activation-segment-${suffix}`;
    const sharedSegmentId = `route-worker-activation-shared-segment-${suffix}`;
    const leaseToken = `route-worker-activation-lease-${suffix}`;
    const routeName = `Worker activation route ${suffix}`;
    const path =
      "SRID=4326;LINESTRING Z (-121 47 100, -121.00005 47.00005 500, -121.0001 47.0001 1000)";
    const sharedPath =
      "SRID=4326;LINESTRING Z (-121 47 100, -121.00005 47.00005 500, -121.0001 47.0001 1000, -121.00015 47.00015 1200)";
    const movedTrailhead =
      "SRID=4326;POINT Z (-121.01 47.01 100)";
    const geometry = {
      type: "LineString",
      coordinates: [
        [-121, 47, 100],
        [-121.00005, 47.00005, 500],
        [-121.0001, 47.0001, 1000],
      ],
    };
    const provenance = {
      source_kind: "test",
      source_url: "https://example.test/worker-activation-source",
      license_name: "Test license",
      license_url: "https://example.test/worker-activation-license",
      attribution: "Worker activation test",
      retrieved_at: "2026-08-27T12:00:00Z",
      osm_way_ids: [],
      osm_way_urls: [],
      contains_osm_geometry: false,
    };
    const identitySources = [
      {
        type: "peakbagger",
        id: "https://www.peakbagger.com/peak.aspx?pid=1",
      },
    ];
    const approvedRouteBinding = {
      routeName,
      routeShape: "out_and_back",
      officialSourceCountryCode: "US",
      destinations: [
        { destinationId: trailheadId, ordinal: 0 },
        { destinationId: summitId, ordinal: 1 },
      ],
      identitySources,
      geometrySource: provenance,
      geometry,
    };
    const operator = new Pool({ connectionString: OPERATOR_DATABASE_URL });
    const factory = new Pool({ connectionString: FACTORY_DATABASE_URL });

    try {
      await operator.query(
        `INSERT INTO destinations (
           id, name, search_name, features, location, country_code
         ) VALUES
           ($1, 'Worker activation summit', 'worker activation summit',
            ARRAY['summit']::destination_feature[],
            ST_GeogFromText('SRID=4326;POINT Z (-121.0001 47.0001 1000)'),
            'US'),
           ($2, 'Worker activation trailhead', 'worker activation trailhead',
            ARRAY['trailhead']::destination_feature[],
            ST_GeogFromText('SRID=4326;POINT Z (-121 47 100)'),
            'US'),
           ($3, 'Worker activation shared summit',
            'worker activation shared summit',
            ARRAY['summit']::destination_feature[],
            ST_GeogFromText('SRID=4326;POINT Z (-121.00015 47.00015 1200)'),
            'US')`,
        [summitId, trailheadId, sharedSummitId]
      );
      await operator.query(
        `UPDATE destinations
         SET hero_image = 'https://upload.wikimedia.org/route-worker-activation.jpg',
             hero_image_attribution = 'Route Worker Activation Photographer',
             hero_image_attribution_url =
               'https://commons.wikimedia.org/wiki/File:Route_worker_activation.jpg'
         WHERE id = $1`,
        [summitId]
      );
      await operator.query(
        `INSERT INTO routes (
           id, name, owner, status, shape, path, external_links, provenance,
           elevation_string, gain, gain_loss
         ) VALUES (
           $1, $2, 'peaks', 'pending', 'out_and_back',
           ST_GeogFromText($3), $4::jsonb, $5::jsonb,
           encode_route_elevation_profile(ST_GeogFromText($3)),
           (SELECT gain FROM route_elevation_stats(ST_GeogFromText($3))),
           (SELECT loss FROM route_elevation_stats(ST_GeogFromText($3)))
         )`,
        [
          routeId,
          routeName,
          path,
          JSON.stringify(identitySources),
          JSON.stringify(provenance),
        ]
      );
      await operator.query(
        `INSERT INTO routes (
           id, name, owner, status, shape, path, external_links, provenance,
           elevation_string, gain, gain_loss
         ) VALUES (
           $1, $2, 'peaks', 'pending', 'out_and_back',
           ST_GeogFromText($3), $4::jsonb, $5::jsonb,
           encode_route_elevation_profile(ST_GeogFromText($3)),
           (SELECT gain FROM route_elevation_stats(ST_GeogFromText($3))),
           (SELECT loss FROM route_elevation_stats(ST_GeogFromText($3)))
         )`,
        [
          sharedRouteId,
          routeName,
          sharedPath,
          JSON.stringify(identitySources),
          JSON.stringify(provenance),
        ]
      );
      await operator.query(
        `INSERT INTO segments (id, path, gain, gain_loss, provenance)
         VALUES
           ($1, ST_GeogFromText($2),
            (SELECT gain FROM route_elevation_stats(ST_GeogFromText($2))),
            (SELECT loss FROM route_elevation_stats(ST_GeogFromText($2))),
            $3::jsonb),
           ($4, ST_GeogFromText($5),
            (SELECT gain FROM route_elevation_stats(ST_GeogFromText($5))),
            (SELECT loss FROM route_elevation_stats(ST_GeogFromText($5))),
            $3::jsonb)`,
        [
          segmentId,
          path,
          JSON.stringify(provenance),
          sharedSegmentId,
          sharedPath,
        ]
      );
      await operator.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES
           ($1, $3, 0), ($1, $4, 1),
           ($2, $3, 0), ($2, $4, 1), ($2, $5, 2)`,
        [routeId, sharedRouteId, trailheadId, summitId, sharedSummitId]
      );
      await operator.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
         VALUES ($1, $3, 0, 'forward'), ($2, $4, 0, 'forward')`,
        [routeId, sharedRouteId, segmentId, sharedSegmentId]
      );
      await operator.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [sharedRouteId]
      );
      await operator.query(
        `INSERT INTO standard_route_backfill_jobs (
           destination_id, state, candidate, review, trailhead_id,
           published_route_id, replacement_route_id,
           lease_owner, lease_token, lease_expires_at
         ) VALUES (
           $1, 'approved', $2::jsonb, $3::jsonb, $4, $5, $6,
           'luna-route-factory-01', $7, now() + interval '1 hour'
         )`,
        [
          summitId,
          JSON.stringify({ official_source_country_code: "US" }),
          JSON.stringify({ approved_route_binding: approvedRouteBinding }),
          trailheadId,
          routeId,
          sharedRouteId,
          leaseToken,
        ]
      );

      assert.equal(
        (
          await operator.query<{ valid: boolean }>(
            `SELECT peaks_route_passes_publish_integrity(
               $1, $2, 'pending'
             ) AS valid`,
            [routeId, summitId]
          )
        ).rows[0]?.valid,
        true,
        "the fixture must pass every publish gate before either drift"
      );

      await operator.query(
        `UPDATE destinations SET country_code = 'CA' WHERE id = $1`,
        [summitId]
      );
      await assert.rejects(
        factory.query(
          `SELECT activate_standard_route_factory($1, $2, $3)`,
          [summitId, routeId, leaseToken]
        ),
        /country no longer matches reviewer approval/
      );
      await operator.query(
        `UPDATE destinations SET country_code = 'US' WHERE id = $1`,
        [summitId]
      );

      await operator.query(
        `UPDATE destinations
         SET location = ST_GeogFromText($2)
         WHERE id = $1`,
        [trailheadId, movedTrailhead]
      );
      assert.equal(
        (
          await operator.query<{ valid: boolean }>(
            `SELECT peaks_route_passes_publish_integrity(
               $1, $2, 'pending'
             ) AS valid`,
            [routeId, summitId]
          )
        ).rows[0]?.valid,
        false,
        "moving the ordinal-zero trailhead must invalidate the route"
      );
      await assert.rejects(
        factory.query(
          `SELECT activate_standard_route_factory($1, $2, $3)`,
          [summitId, routeId, leaseToken]
        ),
        /fails publish integrity/
      );
      await operator.query(
        `UPDATE destinations
         SET location = ST_GeogFromText(
           'SRID=4326;POINT Z (-121 47 100)'
         )
         WHERE id = $1`,
        [trailheadId]
      );
      assert.equal(
        (
          await operator.query<{ valid: boolean }>(
            `SELECT peaks_route_passes_publish_integrity(
               $1, NULL, 'active'
             ) AS valid`,
            [sharedRouteId]
          )
        ).rows[0]?.valid,
        true,
        "the existing multi-summit route must be valid before replacement"
      );
      await assert.rejects(
        factory.query(
          `SELECT activate_standard_route_factory($1, $2, $3)`,
          [summitId, routeId, leaseToken]
        ),
        /cannot retire a valid route shared by multiple summits/
      );
      assert.deepEqual(
        (
          await operator.query<{ id: string; status: string }>(
            `SELECT id, status
             FROM routes
             WHERE id = ANY($1::text[])
             ORDER BY id`,
            [[routeId, sharedRouteId]]
          )
        ).rows,
        [
          { id: routeId, status: "pending" },
          { id: sharedRouteId, status: "active" },
        ].sort((left, right) => left.id.localeCompare(right.id)),
        "failed settlement must roll back activation and preserve shared coverage"
      );
      assert.equal(
        (
          await operator.query<{ state: string }>(
            `SELECT state
             FROM standard_route_backfill_jobs
             WHERE destination_id = $1`,
            [summitId]
          )
        ).rows[0]?.state,
        "approved"
      );
    } finally {
      await operator.query(
        `DELETE FROM standard_route_backfill_jobs WHERE destination_id = $1`,
        [summitId]
      );
      await operator.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [
        [routeId, sharedRouteId],
      ]);
      await operator.query(`DELETE FROM segments WHERE id = ANY($1::text[])`, [
        [segmentId, sharedSegmentId],
      ]);
      await operator.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[summitId, sharedSummitId, trailheadId]]
      );
      await operator.end();
      await factory.end();
    }
  }
);
