-- Read-only catalog preflight for Sloan Peak. Run with cloud-sql/scripts/peaks-psql.
-- Do not infer a missing route if the first query returns no destination or the
-- name/location identifies another place. Keep results private; owner IDs may appear.
\set ON_ERROR_STOP on

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT now() AS audited_at,
       current_setting('transaction_read_only') AS read_only;

SELECT id, name, owner, country_code, state_code, elevation AS elevation_m,
       ST_Y(location::geometry) AS latitude,
       ST_X(location::geometry) AS longitude,
       features
FROM destinations
WHERE id = 'lE8Xh02BVk0o8ew7fuRs';

SELECT l.id, l.name, l.owner
FROM list_destinations ld
JOIN lists l ON l.id = ld.list_id
WHERE ld.destination_id = 'lE8Xh02BVk0o8ew7fuRs'
ORDER BY l.name, l.id;

SELECT r.id, r.name, r.owner, r.status,
       r.distance AS one_way_distance_m, r.gain AS one_way_gain_m,
       r.external_links, r.provenance,
       (SELECT count(*) FROM session_routes sr WHERE sr.route_id = r.id) AS session_count
FROM route_destinations rd
JOIN routes r ON r.id = rd.route_id
WHERE rd.destination_id = 'lE8Xh02BVk0o8ew7fuRs'
ORDER BY r.owner, r.status, r.name, r.id;

-- These counts are meaningful only after confirming the destination above.
SELECT d.id, d.name,
       count(r.id) FILTER (WHERE r.owner = 'peaks' AND r.status = 'active') AS active_peaks_routes,
       count(r.id) FILTER (WHERE r.owner = 'peaks' AND r.status = 'pending') AS pending_peaks_routes,
       count(r.id) FILTER (WHERE r.owner <> 'peaks') AS user_owned_routes
FROM destinations d
LEFT JOIN route_destinations rd ON rd.destination_id = d.id
LEFT JOIN routes r ON r.id = rd.route_id
WHERE d.id = 'lE8Xh02BVk0o8ew7fuRs'
GROUP BY d.id, d.name;

-- Also detect named Peaks routes that may be present without the summit link.
SELECT r.id, r.name, r.owner, r.status,
       EXISTS (
         SELECT 1 FROM route_destinations rd
         WHERE rd.route_id = r.id
           AND rd.destination_id = 'lE8Xh02BVk0o8ew7fuRs'
       ) AS linked_to_sloan
FROM routes r
WHERE r.owner = 'peaks' AND r.name ILIKE '%Sloan%'
ORDER BY r.status, r.name, r.id;

-- Nearby named access leads only: these are NOT approved trailhead bindings.
SELECT d.id, d.name, d.type, d.features,
       d.elevation AS elevation_m,
       ST_Y(d.location::geometry) AS latitude,
       ST_X(d.location::geometry) AS longitude
FROM destinations d
JOIN destinations summit ON summit.id = 'lE8Xh02BVk0o8ew7fuRs'
WHERE d.id <> summit.id
  AND ST_DWithin(d.location, summit.location, 12000)
  AND (d.name ILIKE '%Bedal%' OR d.name ILIKE '%Sloan%' OR d.name ILIKE '%Cougar%')
ORDER BY ST_Distance(d.location, summit.location), d.id;

ROLLBACK;
