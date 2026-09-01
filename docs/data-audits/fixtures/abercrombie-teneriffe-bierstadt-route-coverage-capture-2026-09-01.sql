\set ON_ERROR_STOP on

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH target_summits(destination_id) AS (
  VALUES
    ('8x6A3Evw9623TYnj9CGa'::text),
    ('LAG3Glmi6mUYNr64ixDz'::text),
    ('BM4y2gvTbqY6R9bGJjUl'::text)
),
hard_exclusions(destination_id, route_id) AS (
  VALUES
    ('7nJmKhZy74iFjKUJqtkx'::text, 'jCNuGRP8FNyO8h4QuGIg'::text)
),
listed_destinations AS (
  SELECT DISTINCT d.id AS destination_id
  FROM destinations d
  JOIN list_destinations ld ON ld.destination_id = d.id
  JOIN lists l ON l.id = ld.list_id
  WHERE l.owner = 'peaks'
),
listed_publish_state AS (
  SELECT listed.destination_id,
         COALESCE(
           BOOL_OR(
             CASE
               WHEN r.owner = 'peaks' AND r.status = 'active'
                 THEN peaks_route_passes_publish_integrity(
                   r.id,
                   listed.destination_id,
                   'active'
                 )
               ELSE false
             END
           ),
           false
         ) AS current_publish_valid_route
  FROM listed_destinations listed
  LEFT JOIN route_destinations rd
    ON rd.destination_id = listed.destination_id
  LEFT JOIN routes r ON r.id = rd.route_id
  GROUP BY listed.destination_id
),
coverage_summary AS (
  SELECT COUNT(*)::integer AS listed_destinations,
         COUNT(*) FILTER (
           WHERE current_publish_valid_route
         )::integer AS publish_valid_listed_destinations,
         COUNT(*) FILTER (
           WHERE NOT current_publish_valid_route
         )::integer AS missing_publish_valid_route
  FROM listed_publish_state
),
target_publish_state AS (
  SELECT target.destination_id,
         d.name,
         state.current_publish_valid_route,
         COALESCE(
           ARRAY_AGG(DISTINCT r.id ORDER BY r.id) FILTER (
             WHERE r.owner = 'peaks'
               AND r.status = 'active'
               AND peaks_route_passes_publish_integrity(
                 r.id,
                 target.destination_id,
                 'active'
               )
           ),
           '{}'::text[]
         ) AS publish_valid_route_ids
  FROM target_summits target
  JOIN destinations d ON d.id = target.destination_id
  JOIN listed_publish_state state
    ON state.destination_id = target.destination_id
  LEFT JOIN route_destinations rd
    ON rd.destination_id = target.destination_id
  LEFT JOIN routes r ON r.id = rd.route_id
  GROUP BY target.destination_id, d.name, state.current_publish_valid_route
),
target_destinations AS (
  SELECT d.id,
         d.name,
         d.owner,
         d.features,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lon,
         NULLIF(BTRIM(d.hero_image), '') IS NOT NULL AS hero_image_present,
         d.hero_image_attribution,
         d.hero_image_attribution_url,
         NULLIF(BTRIM(d.hero_image), '') IS NOT NULL
           AND NULLIF(BTRIM(d.hero_image_attribution), '') IS NOT NULL
           AND NULLIF(BTRIM(d.hero_image_attribution_url), '') IS NOT NULL
           AS cover_complete
  FROM destinations d
  WHERE d.id IN (
    SELECT destination_id FROM target_summits
    UNION
    SELECT jobs.trailhead_id
    FROM target_summits target
    JOIN standard_route_backfill_jobs jobs
      ON jobs.destination_id = target.destination_id
    WHERE jobs.trailhead_id IS NOT NULL
  )
),
target_list_memberships AS (
  SELECT ld.destination_id,
         l.id AS list_id,
         l.name AS list_name,
         l.owner AS list_owner,
         ld.ordinal
  FROM target_summits target
  JOIN list_destinations ld ON ld.destination_id = target.destination_id
  JOIN lists l ON l.id = ld.list_id
  WHERE l.owner = 'peaks'
),
target_routes AS (
  SELECT DISTINCT r.id,
         r.name,
         r.owner,
         r.status,
         r.shape,
         r.distance,
         ST_NPOINTS(r.path::geometry) AS point_count,
         (
           SELECT COUNT(*)::integer
           FROM route_segments segments
           WHERE segments.route_id = r.id
         ) AS segment_count,
         COALESCE(
           (
             SELECT JSONB_AGG(
                      JSONB_BUILD_OBJECT(
                        'destination_id', rd_all.destination_id,
                        'ordinal', rd_all.ordinal
                      )
                      ORDER BY rd_all.ordinal, rd_all.destination_id
                    )
             FROM route_destinations rd_all
             WHERE rd_all.route_id = r.id
           ),
           '[]'::jsonb
         ) AS destination_links,
         r.provenance,
         r.external_links,
         peaks_route_passes_publish_integrity(
           r.id,
           target.destination_id,
           r.status
         ) AS machine_integrity_for_current_status,
         ST_Distance(
           ST_EndPoint(r.path::geometry)::geography,
           ST_Force2D(d.location::geometry)::geography
         ) AS summit_gap_m
  FROM target_summits target
  JOIN destinations d ON d.id = target.destination_id
  JOIN route_destinations rd ON rd.destination_id = target.destination_id
  JOIN routes r ON r.id = rd.route_id
),
target_jobs AS (
  SELECT jobs.destination_id,
         jobs.state,
         jobs.trailhead_id,
         jobs.candidate_sha256,
         jobs.published_route_id,
         jobs.replacement_route_id,
         jobs.attempt_count,
         jobs.blocker_code,
         jobs.blocker_message,
         jobs.last_error,
         jobs.candidate,
         jobs.review
  FROM target_summits target
  JOIN standard_route_backfill_jobs jobs
    ON jobs.destination_id = target.destination_id
),
target_candidate_artifacts AS (
  SELECT jobs.destination_id,
         jobs.candidate_sha256,
         jobs.candidate_artifact
  FROM target_summits target
  JOIN standard_route_backfill_jobs jobs
    ON jobs.destination_id = target.destination_id
),
excluded_route AS (
  SELECT excluded.destination_id,
         d.name AS destination_name,
         r.id AS route_id,
         r.name AS route_name,
         r.owner,
         r.status,
         r.shape,
         ST_NPOINTS(r.path::geometry) AS point_count,
         peaks_route_passes_publish_integrity(
           r.id,
           excluded.destination_id,
           r.status
         ) AS machine_integrity_for_current_status
  FROM hard_exclusions excluded
  JOIN destinations d ON d.id = excluded.destination_id
  JOIN routes r ON r.id = excluded.route_id
)
SELECT JSONB_BUILD_OBJECT(
         'schema_version', 1,
         'snapshot_kind', 'next_route_source_packets_read_only_capture',
         'captured_at', TO_CHAR(
           TRANSACTION_TIMESTAMP() AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
         ),
         'transaction_read_only', CURRENT_SETTING('transaction_read_only'),
         'coverage_summary', (
           SELECT TO_JSONB(summary) FROM coverage_summary summary
         ),
         'target_publish_state', COALESCE(
           (
             SELECT JSONB_AGG(TO_JSONB(state) ORDER BY state.destination_id)
             FROM target_publish_state state
           ),
           '[]'::jsonb
         ),
         'target_destinations', COALESCE(
           (
             SELECT JSONB_AGG(TO_JSONB(destination) ORDER BY destination.id)
             FROM target_destinations destination
           ),
           '[]'::jsonb
         ),
         'target_list_memberships', COALESCE(
           (
             SELECT JSONB_AGG(
                      TO_JSONB(membership)
                      ORDER BY membership.destination_id,
                        membership.list_id,
                        membership.ordinal
                    )
             FROM target_list_memberships membership
           ),
           '[]'::jsonb
         ),
         'target_routes', COALESCE(
           (
             SELECT JSONB_AGG(TO_JSONB(route_row) ORDER BY route_row.id)
             FROM target_routes route_row
           ),
           '[]'::jsonb
         ),
         'target_jobs', COALESCE(
           (
             SELECT JSONB_AGG(TO_JSONB(job_row) ORDER BY job_row.destination_id)
             FROM target_jobs job_row
           ),
           '[]'::jsonb
         ),
         'candidate_artifacts', COALESCE(
           (
             SELECT JSONB_AGG(
                      TO_JSONB(candidate_row)
                      ORDER BY candidate_row.destination_id
                    )
             FROM target_candidate_artifacts candidate_row
           ),
           '[]'::jsonb
         ),
         'hard_exclusions', COALESCE(
           (
             SELECT JSONB_AGG(TO_JSONB(exclusion) ORDER BY exclusion.route_id)
             FROM excluded_route exclusion
           ),
           '[]'::jsonb
         )
       );

ROLLBACK;
