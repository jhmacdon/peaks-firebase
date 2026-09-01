-- Forced-read-only replay query for the next reviewed active-route cover batch.
-- Run with PGOPTIONS='-c default_transaction_read_only=on'. The guard returns
-- no packet unless the current transaction is read-only.
-- Fixed infrastructure cost: $0/month.

WITH
read_only_guard AS (
  SELECT true AS valid
  WHERE current_setting('transaction_read_only') = 'on'
),
prior_batch(destination_id) AS (
  VALUES
    ('47D2EFD1234631730AE4'),
    ('9E946D54AC315445CFF9'),
    ('dg1agFR89EivHNOiFvbp'),
    ('42aBrtB02YE3L8h4tTPo'),
    ('DJcLG4ln4RdHQ0zCEXxs'),
    ('nSf6z4vL0zjdG2sXibBM'),
    ('3Q1lVpAXWZFx146E6NUF'),
    ('zntKOa5F6FjN6pzYadwv')
),
next_batch(destination_id) AS (
  VALUES
    ('30FBA25F6A12506D101B'),
    ('6916E6CB5E5C45C02499'),
    ('2E5FFFF77936BBE3C5D7'),
    ('AFD21967E06AA9D81BA1'),
    ('wDFtTKWGTP96rsoi2tNA'),
    ('5hVnUW4tmqj3A6YbU0oB'),
    ('lTBztUOvhj79YWPEtGGV'),
    ('YhxmMJE5KqAsa2jMYlrs')
),
route_cover AS (
  SELECT DISTINCT ON (rd.route_id)
      rd.route_id,
      d.id AS destination_id
  FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE NULLIF(btrim(d.hero_image), '') IS NOT NULL
    AND NULLIF(btrim(d.hero_image_attribution), '') IS NOT NULL
    AND NULLIF(btrim(d.hero_image_attribution_url), '') IS NOT NULL
  ORDER BY
      rd.route_id,
      ('summit'::destination_feature = ANY(d.features)) DESC,
      rd.ordinal DESC,
      d.prominence DESC NULLS LAST,
      d.elevation DESC NULLS LAST,
      d.name ASC NULLS LAST,
      d.id ASC
),
current_uncovered AS (
  SELECT r.id AS route_id
  FROM routes r
  LEFT JOIN route_cover cover ON cover.route_id = r.id
  WHERE r.owner = 'peaks'
    AND r.status = 'active'
    AND cover.route_id IS NULL
),
prior_covered AS (
  SELECT DISTINCT current_uncovered.route_id
  FROM current_uncovered
  JOIN route_destinations rd ON rd.route_id = current_uncovered.route_id
  JOIN prior_batch ON prior_batch.destination_id = rd.destination_id
),
remaining AS (
  SELECT current_uncovered.route_id
  FROM current_uncovered
  WHERE NOT EXISTS (
    SELECT 1
    FROM prior_covered
    WHERE prior_covered.route_id = current_uncovered.route_id
  )
),
next_links AS (
  SELECT DISTINCT remaining.route_id, rd.destination_id
  FROM remaining
  JOIN route_destinations rd ON rd.route_id = remaining.route_id
  JOIN next_batch ON next_batch.destination_id = rd.destination_id
),
active_route_rows AS (
  SELECT
      rd.destination_id,
      r.id AS route_id,
      jsonb_build_object(
        'routeId', r.id,
        'routeName', r.name,
        'owner', r.owner,
        'status', r.status,
        'destinationOrdinal', rd.ordinal,
        'completion', r.completion,
        'distanceM', r.distance,
        'gainM', r.gain,
        'derivedCoverComplete', cover.route_id IS NOT NULL,
        'linkedDestinationIds', ARRAY(
          SELECT linked.destination_id
          FROM route_destinations linked
          WHERE linked.route_id = r.id
          ORDER BY linked.ordinal, linked.destination_id
        )
      ) AS binding
  FROM route_destinations rd
  JOIN routes r ON r.id = rd.route_id
  LEFT JOIN route_cover cover ON cover.route_id = r.id
  WHERE r.owner = 'peaks'
    AND r.status = 'active'
),
active_routes AS (
  SELECT destination_id, jsonb_agg(binding ORDER BY route_id) AS bindings
  FROM active_route_rows
  GROUP BY destination_id
),
lists_json AS (
  SELECT
      ld.destination_id,
      jsonb_agg(
        jsonb_build_object(
          'listId', l.id,
          'listName', l.name,
          'ordinal', ld.ordinal,
          'organization', l.organization,
          'region', l.region,
          'sourceName', l.source_name,
          'sourceUrl', l.source_url
        )
        ORDER BY l.id
      ) AS memberships
  FROM list_destinations ld
  JOIN lists l ON l.id = ld.list_id AND l.owner = 'peaks'
  GROUP BY ld.destination_id
),
history_json AS (
  SELECT
      candidate.destination_id,
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'status', candidate.status,
          'sourcePageUrl', candidate.source_page_url,
          'imageUrl', candidate.image_url,
          'sourceKind', candidate.source_kind,
          'photographer', candidate.photographer,
          'licenseName', candidate.license_name,
          'licenseUrl', candidate.license_url,
          'imageWidth', candidate.image_width,
          'imageHeight', candidate.image_height,
          'mediaSha1', to_jsonb(candidate)->>'media_sha1',
          'candidateOrigin', to_jsonb(candidate)->>'candidate_origin',
          'createdAt', candidate.created_at,
          'updatedAt', candidate.updated_at,
          'reviewedAt', candidate.reviewed_at
        )
        ORDER BY candidate.created_at, candidate.id
      ) AS history
  FROM destination_photo_candidates candidate
  GROUP BY candidate.destination_id
),
target_routes AS (
  SELECT
      next_links.destination_id,
      jsonb_agg(active_route_rows.binding ORDER BY active_route_rows.route_id) AS bindings
  FROM next_links
  JOIN active_route_rows
    ON active_route_rows.route_id = next_links.route_id
   AND active_route_rows.destination_id = next_links.destination_id
  GROUP BY next_links.destination_id
),
packet_destinations AS (
  SELECT
      d.id,
      jsonb_build_object(
        'catalog', jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'owner', d.owner,
          'features', d.features,
          'elevationM', d.elevation,
          'prominenceM', d.prominence,
          'lat', ST_Y(d.location::geometry),
          'lng', ST_X(d.location::geometry),
          'countryCode', d.country_code,
          'stateCode', d.state_code,
          'wikidataId', d.external_ids->>'wikidata',
          'externalIds', d.external_ids,
          'updatedAt', d.updated_at
        ),
        'coverState', jsonb_build_object(
          'heroImageRaw', d.hero_image,
          'heroImageAttributionRaw', d.hero_image_attribution,
          'heroImageAttributionUrlRaw', d.hero_image_attribution_url,
          'focalX', d.hero_image_focal_x,
          'focalY', d.hero_image_focal_y,
          'complete',
            NULLIF(btrim(d.hero_image), '') IS NOT NULL
            AND NULLIF(btrim(d.hero_image_attribution), '') IS NOT NULL
            AND NULLIF(btrim(d.hero_image_attribution_url), '') IS NOT NULL
        ),
        'coverFingerprint', jsonb_build_object(
          'heroImageRaw', d.hero_image,
          'heroImageAttributionRaw', d.hero_image_attribution,
          'heroImageAttributionUrlRaw', d.hero_image_attribution_url,
          'focalX', d.hero_image_focal_x,
          'focalY', d.hero_image_focal_y
        )::text,
        'listMemberships', COALESCE(lists_json.memberships, '[]'::jsonb),
        'photoCandidateHistory', COALESCE(history_json.history, '[]'::jsonb),
        'activeRouteBindings', COALESCE(active_routes.bindings, '[]'::jsonb),
        'activeRouteFingerprint', COALESCE(active_routes.bindings, '[]'::jsonb)::text,
        'remainingUncoveredActiveRoutes', COALESCE(target_routes.bindings, '[]'::jsonb)
      ) AS packet
  FROM next_batch
  JOIN destinations d ON d.id = next_batch.destination_id
  LEFT JOIN lists_json ON lists_json.destination_id = d.id
  LEFT JOIN history_json ON history_json.destination_id = d.id
  LEFT JOIN active_routes ON active_routes.destination_id = d.id
  LEFT JOIN target_routes ON target_routes.destination_id = d.id
)
SELECT jsonb_pretty(jsonb_build_object(
  'schemaVersion', 1,
  'kind', 'next_active_route_cover_gap_audit',
  'generatedAt', clock_timestamp(),
  'source', jsonb_build_object(
    'database', current_database(),
    'defaultTransactionReadOnly', current_setting('default_transaction_read_only'),
    'transactionReadOnly', current_setting('transaction_read_only'),
    'routeCoverViewPresent', to_regclass('public.route_cover_photos') IS NOT NULL,
    'routeCoverProjection',
      'inline exact replay of cloud-sql/migrations/20260830_route_cover_photos.sql',
    'routeProjectionRef',
      'origin/codex/integrate-route-stack-main-20260831@ffcb01d0599ebab1d575eefc6c8a1e9c7f725ee4',
    'implementationBaseRef',
      'origin/codex/add-route-gap-cover-priority-20260901@b3218423f8832ca2474be32038f9093ca03acb55',
    'priorCandidateRefs', jsonb_build_array(
      'origin/codex/add-two-kfs-global-covers-20260901@ae8c63390260b98ff751feead6d8067992f6535d',
      'origin/codex/add-route-gap-cover-priority-20260901@b3218423f8832ca2474be32038f9093ca03acb55'
    ),
    'writes', 0
  ),
  'summary', jsonb_build_object(
    'activePeaksRoutes', (
      SELECT count(*) FROM routes WHERE owner = 'peaks' AND status = 'active'
    ),
    'activePeaksRoutesWithDerivedCover', (
      SELECT count(*)
      FROM routes r
      JOIN route_cover cover ON cover.route_id = r.id
      WHERE r.owner = 'peaks' AND r.status = 'active'
    ),
    'activePeaksRoutesMissingDerivedCoverBeforePriorBatches', (
      SELECT count(*) FROM current_uncovered
    ),
    'priorBatchDestinations', (SELECT count(*) FROM prior_batch),
    'priorBatchDistinctRouteGapReductionIfApproved', (SELECT count(*) FROM prior_covered),
    'activePeaksRoutesMissingDerivedCoverAfterPriorBatchesIfApproved', (
      SELECT count(*) FROM remaining
    ),
    'nextBatchDestinations', (SELECT count(*) FROM next_batch),
    'nextBatchUncoveredActiveRouteLinks', (SELECT count(*) FROM next_links),
    'nextBatchDistinctRouteGapReductionIfApprovedLater', (
      SELECT count(DISTINCT route_id) FROM next_links
    ),
    'activePeaksRoutesMissingDerivedCoverAfterNextBatchIfApprovedLater',
      (SELECT count(*) FROM remaining)
      - (SELECT count(DISTINCT route_id) FROM next_links),
    'productionWrites', 0,
    'applyUsed', false,
    'fixedMonthlyCostUsd', 0
  ),
  'destinations', (
    SELECT jsonb_agg(packet ORDER BY id) FROM packet_destinations
  )
))
FROM read_only_guard;
