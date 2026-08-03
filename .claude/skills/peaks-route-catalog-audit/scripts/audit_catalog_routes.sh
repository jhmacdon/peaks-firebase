#!/usr/bin/env bash
set -euo pipefail

destination_id=""
destination_name=""
route_id=""
audit_all="false"
route_status="active"
format="summary"
row_limit="200"
print_sql="false"

usage() {
  printf '%s\n' \
    "Usage: $0 (--destination-id ID | --destination-name NAME | --route-id ID | --all)" \
    "          [--status active|pending|catalog|all] [--limit N]" \
    "          [--format summary|tsv|json] [--print-sql]" \
    "" \
    "Read-only audit of Peaks-owned summit routes in Cloud SQL."
}

while (($#)); do
  case "$1" in
    --destination-id)
      destination_id="${2:?--destination-id requires a value}"
      shift 2
      ;;
    --destination-name)
      destination_name="${2:?--destination-name requires a value}"
      shift 2
      ;;
    --route-id)
      route_id="${2:?--route-id requires a value}"
      shift 2
      ;;
    --all)
      audit_all="true"
      shift
      ;;
    --status)
      route_status="${2:?--status requires a value}"
      shift 2
      ;;
    --limit)
      row_limit="${2:?--limit requires a value}"
      shift 2
      ;;
    --format)
      format="${2:?--format requires a value}"
      shift 2
      ;;
    --print-sql)
      print_sql="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

scope_count=0
[[ -n "$destination_id" ]] && scope_count=$((scope_count + 1))
[[ -n "$destination_name" ]] && scope_count=$((scope_count + 1))
[[ -n "$route_id" ]] && scope_count=$((scope_count + 1))
[[ "$audit_all" == "true" ]] && scope_count=$((scope_count + 1))
if ((scope_count != 1)); then
  printf '%s\n' "Choose exactly one audit scope" >&2
  usage >&2
  exit 2
fi
for value in "$destination_id" "$route_id"; do
  if [[ -n "$value" && ! "$value" =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf '%s\n' "IDs may contain only letters, numbers, _ and -" >&2
    exit 2
  fi
done
if [[ "$route_status" != "active" && "$route_status" != "pending" &&
      "$route_status" != "catalog" && "$route_status" != "all" ]]; then
  printf '%s\n' "--status must be active, pending, catalog, or all" >&2
  exit 2
fi
if [[ "$format" != "summary" && "$format" != "tsv" && "$format" != "json" ]]; then
  printf '%s\n' "--format must be summary, tsv, or json" >&2
  exit 2
fi
if ! [[ "$row_limit" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s\n' "--limit must be a positive integer" >&2
  exit 2
fi

read -r -d '' common_sql <<'SQL' || true
WITH route_status_scope AS (
  SELECT r.*
  FROM routes r
  WHERE r.owner = 'peaks'
    AND (
      :'route_status' = 'all'
      OR r.status = :'route_status'
      OR (
        :'route_status' = 'catalog'
        AND (
          r.status = 'active'
          OR (
            r.status = 'superseded'
            AND r.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
            AND r.provenance IS NULL
            AND r.completion = 'none'
            AND r.shape IS NULL
            AND r.gain IS NULL
            AND r.gain_loss IS NULL
            AND jsonb_typeof(r.external_links) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(r.external_links) link
              WHERE link->>'type' = 'osm'
                AND link->>'id' ~ '^relation/[0-9]+$'
            )
            AND NOT EXISTS (
              SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM route_destinations rd
              JOIN destinations d ON d.id = rd.destination_id
              WHERE rd.route_id = r.id
                AND 'trailhead'::destination_feature = ANY(d.features)
            )
          )
        )
      )
    )
),
scope_destinations AS (
  SELECT d.id, d.name, d.search_name, d.country_code, d.external_ids, d.metadata
  FROM destinations d
  WHERE 'summit'::destination_feature = ANY(d.features)
    AND (
      (:'destination_id' <> '' AND d.id = :'destination_id')
      OR (:'destination_name' <> '' AND lower(d.name) = lower(:'destination_name'))
      OR (
        :'audit_all'::boolean
        AND EXISTS (
          SELECT 1
          FROM route_destinations audit_link
          JOIN route_status_scope audit_route ON audit_route.id = audit_link.route_id
          WHERE audit_link.destination_id = d.id
        )
      )
      OR (
        :'route_id' <> ''
        AND EXISTS (
          SELECT 1 FROM route_destinations rd
          WHERE rd.route_id = :'route_id' AND rd.destination_id = d.id
        )
      )
    )
  ORDER BY d.id
  LIMIT :'row_limit'::integer
),
scope_routes AS (
  SELECT r.*
  FROM route_status_scope r
  WHERE (
      (:'route_id' <> '' AND r.id = :'route_id')
      OR (
        :'route_id' = ''
        AND EXISTS (
          SELECT 1
          FROM route_destinations rd
          JOIN scope_destinations sd ON sd.id = rd.destination_id
          WHERE rd.route_id = r.id
        )
      )
    )
),
route_context AS (
  SELECT sr.*,
         (
           SELECT COUNT(*)::int FROM route_destinations rd
           WHERE rd.route_id = sr.id
         ) AS destination_count,
         (
           SELECT COUNT(DISTINCT rd.ordinal)::int FROM route_destinations rd
           WHERE rd.route_id = sr.id
         ) AS destination_ordinal_count,
         first_destination.id AS first_destination_id,
         first_destination.name AS first_destination_name,
         first_destination.features AS first_destination_features,
         first_destination.elevation AS first_destination_elevation,
         first_destination.location AS first_destination_location,
         last_destination.id AS last_destination_id,
         last_destination.name AS last_destination_name,
         last_destination.features AS last_destination_features,
         last_destination.elevation AS last_destination_elevation,
         last_destination.location AS last_destination_location,
         summit_links.summit_ids,
         summit_links.summit_names,
         summit_contact.summit_count,
         summit_contact.worst_summit_gap_m,
         summit_contact.fault_summit_ids,
         summit_contact.fault_summit_names,
         summit_contact.fault_summit_gaps_m,
         nearest_trailhead.id AS nearest_trailhead_id,
         nearest_trailhead.name AS nearest_trailhead_name,
         nearest_trailhead.gap_m AS nearest_trailhead_gap_m
  FROM scope_routes sr
  LEFT JOIN LATERAL (
    SELECT d.id, d.name, d.features, d.elevation, d.location
    FROM route_destinations rd
    JOIN destinations d ON d.id = rd.destination_id
    WHERE rd.route_id = sr.id
    ORDER BY rd.ordinal, d.id
    LIMIT 1
  ) first_destination ON true
  LEFT JOIN LATERAL (
    SELECT d.id, d.name, d.features, d.elevation, d.location
    FROM route_destinations rd
    JOIN destinations d ON d.id = rd.destination_id
    WHERE rd.route_id = sr.id
    ORDER BY rd.ordinal DESC, d.id
    LIMIT 1
  ) last_destination ON true
  LEFT JOIN LATERAL (
    SELECT STRING_AGG(d.id, ' | ' ORDER BY rd.ordinal, d.id) AS summit_ids,
           STRING_AGG(d.name, ' | ' ORDER BY rd.ordinal, d.id) AS summit_names
    FROM route_destinations rd
    JOIN destinations d ON d.id = rd.destination_id
    WHERE rd.route_id = sr.id
      AND 'summit'::destination_feature = ANY(d.features)
  ) summit_links ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS summit_count,
           MAX(ST_Distance(sr.path, d.location)) AS worst_summit_gap_m,
           COALESCE(JSONB_AGG(d.id ORDER BY rd.ordinal, d.id) FILTER (
             WHERE sr.path IS NULL OR d.location IS NULL
                OR ST_Distance(sr.path, d.location) > 5
           ), '[]'::jsonb) AS fault_summit_ids,
           COALESCE(JSONB_AGG(d.name ORDER BY rd.ordinal, d.id) FILTER (
             WHERE sr.path IS NULL OR d.location IS NULL
                OR ST_Distance(sr.path, d.location) > 5
           ), '[]'::jsonb) AS fault_summit_names,
           COALESCE(JSONB_AGG(
             CASE WHEN sr.path IS NULL OR d.location IS NULL THEN NULL
                  ELSE ROUND(ST_Distance(sr.path, d.location)::numeric, 1)
             END ORDER BY rd.ordinal, d.id
           ) FILTER (
             WHERE sr.path IS NULL OR d.location IS NULL
                OR ST_Distance(sr.path, d.location) > 5
           ), '[]'::jsonb) AS fault_summit_gaps_m
    FROM route_destinations rd
    JOIN destinations d ON d.id = rd.destination_id
    WHERE rd.route_id = sr.id
      AND 'summit'::destination_feature = ANY(d.features)
  ) summit_contact ON true
  LEFT JOIN LATERAL (
    SELECT d.id, d.name,
           ST_Distance(
             d.location,
             ST_StartPoint(sr.path::geometry)::geography
           ) AS gap_m
    FROM destinations d
    WHERE sr.path IS NOT NULL
      AND 'trailhead'::destination_feature = ANY(d.features)
    ORDER BY d.location <-> ST_StartPoint(sr.path::geometry)::geography
    LIMIT 1
  ) nearest_trailhead ON true
),
route_geometry AS (
  SELECT rc.id AS route_id,
         ST_NPoints(rc.path::geometry)::int AS point_count,
         ST_IsValid(rc.path::geometry) AS is_valid,
         ST_IsSimple(rc.path::geometry) AS is_simple,
         ST_Length(rc.path) AS measured_distance_m,
         ST_ZMin(Box3D(rc.path::geometry)) AS min_z,
         ST_ZMax(Box3D(rc.path::geometry)) AS max_z,
         ST_Z(ST_StartPoint(rc.path::geometry)) AS start_z,
         ST_Z(ST_EndPoint(rc.path::geometry)) AS end_z,
         ST_Distance(
           ST_StartPoint(rc.path::geometry)::geography,
           rc.first_destination_location
         ) AS start_destination_gap_m,
         ST_Distance(
           ST_EndPoint(rc.path::geometry)::geography,
           rc.last_destination_location
         ) AS end_destination_gap_m,
         steps.max_step_m
  FROM route_context rc
  LEFT JOIN LATERAL (
    SELECT MAX(
             ST_Distance(point::geography, prior_point::geography)
           ) AS max_step_m
    FROM (
      SELECT (dp).geom AS point,
             LAG((dp).geom) OVER (ORDER BY (dp).path[1]) AS prior_point
      FROM ST_DumpPoints(rc.path::geometry) dp
    ) route_steps
    WHERE prior_point IS NOT NULL
  ) steps ON true
  WHERE rc.path IS NOT NULL
),
segment_steps AS (
  SELECT rs.route_id, rs.segment_id, rs.ordinal, rs.direction,
         CASE rs.direction
           WHEN 'forward' THEN ST_StartPoint(s.path::geometry)
           ELSE ST_EndPoint(s.path::geometry)
         END AS start_point,
         CASE rs.direction
           WHEN 'forward' THEN ST_EndPoint(s.path::geometry)
           ELSE ST_StartPoint(s.path::geometry)
         END AS end_point,
         s.path::geometry AS path,
         s.distance,
         s.gain AS stored_gain,
         s.gain_loss AS stored_gain_loss,
         elevation_stats.gain AS computed_gain,
         elevation_stats.loss AS computed_gain_loss,
         CASE rs.direction WHEN 'forward' THEN s.gain ELSE s.gain_loss END AS gain,
         CASE rs.direction WHEN 'forward' THEN s.gain_loss ELSE s.gain END AS gain_loss,
         s.provenance,
         LAG(
           CASE rs.direction
             WHEN 'forward' THEN ST_EndPoint(s.path::geometry)
             ELSE ST_StartPoint(s.path::geometry)
           END
         ) OVER (
           PARTITION BY rs.route_id ORDER BY rs.ordinal, rs.segment_id
         ) AS prior_end_point
  FROM route_segments rs
  JOIN segments s ON s.id = rs.segment_id
  JOIN scope_routes scoped ON scoped.id = rs.route_id
  CROSS JOIN LATERAL route_elevation_stats(s.path) elevation_stats
),
segment_metrics AS (
  SELECT rc.id AS route_id,
         COUNT(ss.segment_id)::int AS segment_count,
         COUNT(DISTINCT ss.ordinal)::int AS segment_ordinal_count,
         SUM(ss.distance) AS segment_distance_m,
         SUM(ss.gain) AS segment_gain_m,
         SUM(ss.gain_loss) AS segment_loss_m,
         COUNT(*) FILTER (
           WHERE ss.stored_gain IS DISTINCT FROM ss.computed_gain
              OR ss.stored_gain_loss IS DISTINCT FROM ss.computed_gain_loss
         )::int AS segment_elevation_stats_mismatch_count,
         COALESCE(JSONB_AGG(ss.segment_id ORDER BY ss.ordinal, ss.segment_id)
           FILTER (
             WHERE ss.stored_gain IS DISTINCT FROM ss.computed_gain
                OR ss.stored_gain_loss IS DISTINCT FROM ss.computed_gain_loss
           ), '[]'::jsonb) AS segment_elevation_stats_mismatch_ids,
         BOOL_AND(ss.provenance IS NOT DISTINCT FROM rc.provenance)
           AS segment_provenance_matches,
         MAX(
           CASE WHEN ss.prior_end_point IS NULL THEN 0
             ELSE ST_Distance(
               ss.prior_end_point::geography,
               ss.start_point::geography
             )
           END
         ) AS max_segment_gap_m,
         ST_Distance(
           ST_StartPoint(rc.path::geometry)::geography,
           (ARRAY_AGG(ss.start_point ORDER BY ss.ordinal, ss.segment_id))[1]::geography
         ) AS route_segment_start_gap_m,
         ST_Distance(
           ST_EndPoint(rc.path::geometry)::geography,
           (ARRAY_AGG(ss.end_point ORDER BY ss.ordinal DESC, ss.segment_id DESC))[1]::geography
         ) AS route_segment_end_gap_m,
         ST_UnaryUnion(ST_Collect(ST_Force2D(ss.path))) AS segment_union
  FROM route_context rc
  LEFT JOIN segment_steps ss ON ss.route_id = rc.id
  GROUP BY rc.id, rc.provenance, rc.path
),
segment_path_metrics AS (
  SELECT rc.id AS route_id,
         route_offsets.max_offset_m AS route_to_segment_max_m,
         segment_offsets.max_offset_m AS segment_to_route_max_m
  FROM route_context rc
  JOIN segment_metrics sm ON sm.route_id = rc.id AND sm.segment_count > 0
  LEFT JOIN LATERAL (
    SELECT MAX(
             ST_Distance((dp).geom::geography, sm.segment_union::geography)
           ) AS max_offset_m
    FROM ST_DumpPoints(rc.path::geometry) dp
  ) route_offsets ON true
  LEFT JOIN LATERAL (
    SELECT MAX(
             ST_Distance((dp).geom::geography, rc.path)
           ) AS max_offset_m
    FROM ST_DumpPoints(sm.segment_union) dp
  ) segment_offsets ON true
),
route_sessions AS (
  SELECT sr.id AS route_id, COUNT(DISTINCT linked.session_id)::int AS session_count
  FROM scope_routes sr
  LEFT JOIN session_routes linked ON linked.route_id = sr.id
  GROUP BY sr.id
),
route_metrics AS (
  SELECT rc.*,
         rg.point_count, rg.is_valid, rg.is_simple, rg.measured_distance_m,
         rg.min_z, rg.max_z, rg.start_z, rg.end_z,
         rg.start_destination_gap_m, rg.end_destination_gap_m, rg.max_step_m,
         elevation_stats.gain AS computed_gain,
         elevation_stats.loss AS computed_gain_loss,
         COALESCE(sm.segment_count, 0) AS segment_count,
         COALESCE(sm.segment_ordinal_count, 0) AS segment_ordinal_count,
         sm.segment_distance_m, sm.segment_gain_m, sm.segment_loss_m,
         sm.segment_elevation_stats_mismatch_count,
         sm.segment_elevation_stats_mismatch_ids,
         sm.segment_provenance_matches, sm.max_segment_gap_m,
         sm.route_segment_start_gap_m, sm.route_segment_end_gap_m,
         spm.route_to_segment_max_m, spm.segment_to_route_max_m,
         sessions.session_count
  FROM route_context rc
  LEFT JOIN route_geometry rg ON rg.route_id = rc.id
  LEFT JOIN segment_metrics sm ON sm.route_id = rc.id
  LEFT JOIN segment_path_metrics spm ON spm.route_id = rc.id
  CROSS JOIN LATERAL route_elevation_stats(rc.path) elevation_stats
  LEFT JOIN route_sessions sessions ON sessions.route_id = rc.id
),
route_issue_groups AS (
  SELECT rm.*,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN rm.path IS NULL THEN 'missing_path' END,
           CASE WHEN rm.path IS NOT NULL AND rm.point_count < 5 THEN 'too_few_points' END,
           CASE WHEN rm.path IS NOT NULL AND NOT COALESCE(rm.is_valid, false) THEN 'invalid_geometry' END,
           CASE WHEN rm.path IS NOT NULL AND NOT COALESCE(rm.is_simple, false) THEN 'self_intersection' END,
           CASE WHEN NOT COALESCE(is_valid_route_provenance(rm.provenance), false) THEN 'missing_or_invalid_provenance' END,
           CASE WHEN rm.segment_count = 0 THEN 'missing_route_segments' END,
           CASE WHEN rm.segment_count <> rm.segment_ordinal_count THEN 'repeated_segment_ordinal' END,
           CASE WHEN rm.segment_count > 0 AND NOT COALESCE(rm.segment_provenance_matches, false) THEN 'route_segment_provenance_mismatch' END,
           CASE WHEN rm.max_segment_gap_m > 100 THEN 'segment_gap_gt_100m' END,
           CASE WHEN GREATEST(rm.route_to_segment_max_m, rm.segment_to_route_max_m) > 30 THEN 'materialized_path_mismatch_gt_30m' END,
           CASE WHEN GREATEST(rm.route_segment_start_gap_m, rm.route_segment_end_gap_m) > 30 THEN 'materialized_endpoint_mismatch_gt_30m' END,
           CASE WHEN rm.destination_count = 0 THEN 'missing_linked_destinations' END,
           CASE WHEN rm.destination_count > 0 AND NOT COALESCE('trailhead'::destination_feature = ANY(rm.first_destination_features), false) THEN 'missing_or_misordered_trailhead_link' END,
           CASE WHEN rm.destination_count > 0 AND NOT COALESCE('summit'::destination_feature = ANY(rm.last_destination_features), false) THEN 'missing_or_misordered_summit_link' END,
           CASE WHEN COALESCE('trailhead'::destination_feature = ANY(rm.first_destination_features), false) AND rm.start_destination_gap_m > 300 THEN 'start_over_300m_from_trailhead' END,
           CASE WHEN rm.summit_count > 0
                 AND JSONB_ARRAY_LENGTH(rm.fault_summit_ids) > 0
             THEN 'route_misses_linked_summit_gt_5m' END,
           CASE WHEN rm.shape IN ('out_and_back', 'point_to_point')
                 AND COALESCE('summit'::destination_feature = ANY(rm.last_destination_features), false)
                 AND (rm.end_destination_gap_m IS NULL OR rm.end_destination_gap_m > 5)
             THEN 'end_over_5m_from_summit' END,
           CASE WHEN rm.distance IS NULL OR rm.distance <= 0 THEN 'missing_or_invalid_distance' END,
           CASE WHEN rm.gain IS NULL OR rm.gain < 0 OR rm.gain_loss IS NULL OR rm.gain_loss < 0 THEN 'missing_or_invalid_gain' END,
           CASE WHEN rm.gain IS DISTINCT FROM rm.computed_gain
                       OR rm.gain_loss IS DISTINCT FROM rm.computed_gain_loss
             THEN 'route_elevation_stats_mismatch' END,
           CASE WHEN COALESCE(rm.segment_elevation_stats_mismatch_count, 0) > 0
             THEN 'segment_elevation_stats_mismatch' END,
           CASE
             WHEN rm.path IS NULL OR rm.elevation_string IS NULL
               THEN 'missing_or_invalid_elevation_profile'
             WHEN rm.elevation_string IS DISTINCT FROM encode_route_elevation_profile(rm.path)
               THEN 'missing_or_invalid_elevation_profile'
           END,
           CASE
             WHEN rm.path IS NOT NULL
               AND NOT route_elevation_profile_has_real_range(rm.path)
             THEN 'flat_or_placeholder_elevation_profile'
           END,
           CASE WHEN rm.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
             AND rm.provenance IS NULL
             AND rm.segment_count = 0
             AND NOT COALESCE('trailhead'::destination_feature = ANY(rm.first_destination_features), false)
             AND rm.completion = 'none'
             AND rm.shape IS NULL
             AND rm.gain IS NULL
             AND rm.gain_loss IS NULL
             AND jsonb_typeof(rm.external_links) = 'array'
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements(rm.external_links) link
               WHERE link->>'type' = 'osm'
                 AND link->>'id' ~ '^relation/[0-9]+$'
             )
           THEN 'legacy_route_coverage_import' END
         ], NULL)::text[] AS error_issues,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN rm.shape IS NULL THEN 'missing_route_shape' END,
           CASE WHEN rm.polyline6 IS NULL OR rm.polyline6 = '' THEN 'missing_polyline6' END,
           CASE WHEN rm.destination_count <> rm.destination_ordinal_count THEN 'repeated_destination_ordinal' END,
           CASE WHEN rm.measured_distance_m IS NOT NULL AND rm.distance IS NOT NULL AND ABS(rm.measured_distance_m - rm.distance) > GREATEST(100, rm.measured_distance_m * 0.02) THEN 'stored_distance_drift' END,
           CASE WHEN rm.max_step_m > 250 THEN 'point_jump_gt_250m' END,
           CASE WHEN rm.max_segment_gap_m > 5 AND rm.max_segment_gap_m <= 100 THEN 'segment_gap_gt_5m' END,
           CASE WHEN GREATEST(rm.route_to_segment_max_m, rm.segment_to_route_max_m) > 3 AND GREATEST(rm.route_to_segment_max_m, rm.segment_to_route_max_m) <= 30 THEN 'materialized_path_mismatch_gt_3m' END,
           CASE WHEN GREATEST(rm.route_segment_start_gap_m, rm.route_segment_end_gap_m) > 3 AND GREATEST(rm.route_segment_start_gap_m, rm.route_segment_end_gap_m) <= 30 THEN 'materialized_endpoint_mismatch_gt_3m' END,
           CASE WHEN rm.segment_count > 0 AND rm.distance IS NOT NULL AND ABS(rm.distance - rm.segment_distance_m) > GREATEST(10, rm.distance * 0.02) THEN 'segment_distance_drift' END,
           CASE WHEN rm.segment_count > 0 AND rm.gain IS NOT NULL AND ABS(rm.gain - rm.segment_gain_m) > GREATEST(10, rm.gain * 0.02) THEN 'segment_gain_drift' END,
           CASE WHEN rm.segment_count > 0 AND rm.gain_loss IS NOT NULL AND ABS(rm.gain_loss - rm.segment_loss_m) > GREATEST(10, GREATEST(rm.gain_loss, 1) * 0.02) THEN 'segment_loss_drift' END,
           CASE WHEN COALESCE('summit'::destination_feature = ANY(rm.last_destination_features), false) AND rm.last_destination_elevation IS NOT NULL AND rm.end_z IS NOT NULL AND ABS(rm.end_z - rm.last_destination_elevation) > 100 THEN 'summit_elevation_mismatch_gt_100m' END,
           CASE WHEN rm.measured_distance_m > 25000 THEN 'extreme_one_way_distance_gt_25km' END
         ], NULL)::text[] AS warning_issues
  FROM route_metrics rm
),
route_audit AS (
  SELECT rig.*,
         CASE
           WHEN CARDINALITY(rig.error_issues) > 0 THEN 'ERROR'
           WHEN CARDINALITY(rig.warning_issues) > 0 THEN 'WARN'
           ELSE 'PASS'
         END AS severity,
         rig.error_issues || rig.warning_issues AS issues
  FROM route_issue_groups rig
),
pair_base AS (
  SELECT sd.id AS destination_id, sd.name AS destination_name,
         left_route.id AS left_id, left_route.name AS left_name,
         right_route.id AS right_id, right_route.name AS right_name,
         left_route.path::geometry AS left_path,
         right_route.path::geometry AS right_path,
         left_route.measured_distance_m AS left_distance_m,
         right_route.measured_distance_m AS right_distance_m,
         CASE WHEN COALESCE('trailhead'::destination_feature = ANY(left_route.first_destination_features), false)
           THEN left_route.first_destination_id END AS left_trailhead_id,
         CASE WHEN COALESCE('trailhead'::destination_feature = ANY(left_route.first_destination_features), false)
           THEN left_route.first_destination_name END AS left_trailhead_name,
         CASE WHEN COALESCE('trailhead'::destination_feature = ANY(right_route.first_destination_features), false)
           THEN right_route.first_destination_id END AS right_trailhead_id,
         CASE WHEN COALESCE('trailhead'::destination_feature = ANY(right_route.first_destination_features), false)
           THEN right_route.first_destination_name END AS right_trailhead_name
  FROM scope_destinations sd
  JOIN route_destinations left_link ON left_link.destination_id = sd.id
  JOIN route_audit left_route ON left_route.id = left_link.route_id
  JOIN route_destinations right_link ON right_link.destination_id = sd.id
  JOIN route_audit right_route ON right_route.id = right_link.route_id
    AND left_route.id < right_route.id
  WHERE left_route.path IS NOT NULL
    AND right_route.path IS NOT NULL
    AND left_route.status = 'active'
    AND right_route.status = 'active'
),
pair_metrics AS (
  SELECT pb.*,
         ST_Distance(
           ST_StartPoint(pb.left_path)::geography,
           ST_StartPoint(pb.right_path)::geography
         ) AS start_separation_m,
         crossings.internal_crossings,
         intersection_metrics.exact_shared_m,
         LEAST(left_near.near_m, right_near.near_m) AS close_overlap_m,
         LEAST(
           left_near.near_m / NULLIF(pb.left_distance_m, 0),
           right_near.near_m / NULLIF(pb.right_distance_m, 0)
         ) AS close_overlap_fraction
  FROM pair_base pb
  CROSS JOIN LATERAL (
    SELECT ST_Intersection(
             ST_Force2D(pb.left_path), ST_Force2D(pb.right_path)
           ) AS geometry
  ) pair_intersection
  CROSS JOIN LATERAL (
    SELECT COUNT(*) FILTER (
             WHERE ST_LineLocatePoint(ST_Force2D(pb.left_path), (dp).geom) BETWEEN 0.001 AND 0.999
               AND ST_LineLocatePoint(ST_Force2D(pb.right_path), (dp).geom) BETWEEN 0.001 AND 0.999
           )::int AS internal_crossings
    FROM ST_DumpPoints(ST_CollectionExtract(pair_intersection.geometry, 1)) dp
  ) crossings
  CROSS JOIN LATERAL (
    SELECT COALESCE(
             ST_Length(
               ST_CollectionExtract(pair_intersection.geometry, 2)::geography
             ),
             0
           ) AS exact_shared_m
  ) intersection_metrics
  CROSS JOIN LATERAL (
    SELECT LEAST(
             COUNT(*) FILTER (
               WHERE ST_DWithin((dp).geom::geography, pb.right_path::geography, 30)
             ) * 25.0,
             pb.left_distance_m
           ) AS near_m
    FROM ST_DumpPoints(ST_Segmentize(pb.left_path::geography, 25)::geometry) dp
  ) left_near
  CROSS JOIN LATERAL (
    SELECT LEAST(
             COUNT(*) FILTER (
               WHERE ST_DWithin((dp).geom::geography, pb.left_path::geography, 30)
             ) * 25.0,
             pb.right_distance_m
           ) AS near_m
    FROM ST_DumpPoints(ST_Segmentize(pb.right_path::geography, 25)::geometry) dp
  ) right_near
),
pair_issue_groups AS (
  SELECT pm.*,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN pm.close_overlap_fraction >= 0.95 AND pm.start_separation_m <= 300 THEN 'probable_duplicate_routes' END
         ], NULL)::text[] AS error_issues,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN pm.internal_crossings >= 3 AND pm.close_overlap_m >= 500 AND pm.exact_shared_m < 500 THEN 'route_pair_weaves' END,
           CASE WHEN pm.internal_crossings BETWEEN 1 AND 2 THEN 'route_pair_crosses' END,
           CASE WHEN pm.internal_crossings >= 3 AND NOT (pm.close_overlap_m >= 500 AND pm.exact_shared_m < 500) THEN 'route_pair_crosses' END,
           CASE WHEN pm.close_overlap_fraction >= 0.80 AND NOT (pm.close_overlap_fraction >= 0.95 AND pm.start_separation_m <= 300) THEN 'near_duplicate_routes' END,
           CASE WHEN pm.start_separation_m > 1000 AND (pm.left_trailhead_id IS NULL OR pm.right_trailhead_id IS NULL OR pm.left_trailhead_id = pm.right_trailhead_id) THEN 'unexplained_start_separation' END
         ], NULL)::text[] AS warning_issues,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN pm.start_separation_m > 1000 AND pm.left_trailhead_id IS NOT NULL AND pm.right_trailhead_id IS NOT NULL AND pm.left_trailhead_id <> pm.right_trailhead_id THEN 'distinct_trailheads' END
         ], NULL)::text[] AS info_issues
  FROM pair_metrics pm
),
pair_audit AS (
  SELECT pig.*,
         CASE
           WHEN CARDINALITY(pig.error_issues) > 0 THEN 'ERROR'
           WHEN CARDINALITY(pig.warning_issues) > 0 THEN 'WARN'
           WHEN CARDINALITY(pig.info_issues) > 0 THEN 'INFO'
           ELSE 'PASS'
         END AS severity,
         pig.error_issues || pig.warning_issues || pig.info_issues AS issues
  FROM pair_issue_groups pig
),
selection_candidate_base AS (
  SELECT sd.id AS destination_id, sd.name AS destination_name,
         r.id AS route_id, r.name AS route_name, r.distance,
         COUNT(DISTINCT sr.session_id)::int AS session_count
  FROM scope_destinations sd
  JOIN route_destinations rd ON rd.destination_id = sd.id
  JOIN routes r ON r.id = rd.route_id
  LEFT JOIN session_routes sr ON sr.route_id = r.id
  WHERE r.owner = 'peaks' AND r.status = 'active'
  GROUP BY sd.id, sd.name, r.id
),
selection_ranked AS (
  SELECT scb.*,
         COUNT(*) OVER (PARTITION BY scb.destination_id)::int AS active_route_count,
         ROW_NUMBER() OVER (
           PARTITION BY scb.destination_id
           ORDER BY scb.session_count DESC NULLS LAST,
                    scb.distance ASC NULLS LAST,
                    scb.route_id
         ) AS route_rank
  FROM selection_candidate_base scb
),
selection_audit AS (
  SELECT sr.*,
         CASE
           WHEN ra.severity = 'ERROR' THEN 'ERROR'
           WHEN sr.active_route_count > 1 THEN 'REVIEW'
           ELSE 'PASS'
         END AS severity,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN ra.severity = 'ERROR' THEN 'selected_route_has_errors' END,
           CASE WHEN sr.active_route_count > 1 THEN 'active_route_choice_requires_source_review' END
         ], NULL)::text[] AS issues
  FROM selection_ranked sr
  LEFT JOIN route_audit ra ON ra.id = sr.route_id
  WHERE sr.route_rank = 1
),
records AS (
  SELECT 0 AS record_order,
         'scope'::text AS record_type,
         CASE WHEN (SELECT COUNT(*) FROM scope_routes) = 0 THEN 'ERROR' ELSE 'INFO' END AS severity,
         NULL::text AS destination_id,
         NULL::text AS destination_name,
         NULL::text AS item_id,
         NULL::text AS item_name,
         NULL::text AS other_id,
         NULL::text AS other_name,
         CASE WHEN (SELECT COUNT(*) FROM scope_routes) = 0
           THEN ARRAY['no_routes_in_scope']::text[]
           ELSE ARRAY[]::text[] END AS issues,
         JSONB_BUILD_OBJECT(
           'route_count', (SELECT COUNT(*) FROM scope_routes),
           'destination_count', (SELECT COUNT(*) FROM scope_destinations),
           'status', :'route_status'
         ) AS metrics
  UNION ALL
  SELECT 1, 'identity',
         CASE
           WHEN sd.search_name IS NULL OR btrim(sd.search_name) = '' THEN 'WARN'
           WHEN sd.name !~ '^[ -~]+$'
             AND (
               COALESCE(sd.external_ids, '{}'::jsonb) ? 'osm'
               OR COALESCE(sd.external_ids, '{}'::jsonb) ? 'wikidata'
             ) THEN 'REVIEW'
           ELSE 'INFO'
         END,
         sd.id, sd.name, NULL, NULL, NULL, NULL,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN sd.search_name IS NULL OR btrim(sd.search_name) = ''
             THEN 'missing_search_name' END,
           CASE WHEN sd.name !~ '^[ -~]+$'
             AND (
               COALESCE(sd.external_ids, '{}'::jsonb) ? 'osm'
               OR COALESCE(sd.external_ids, '{}'::jsonb) ? 'wikidata'
             ) THEN 'localized_display_name_requires_source_review' END
         ], NULL)::text[],
         JSONB_BUILD_OBJECT(
           'stored_name', sd.name,
           'search_name', sd.search_name,
           'names', COALESCE(sd.metadata->'names', '{}'::jsonb),
           'country_code', sd.country_code,
           'osm_id', sd.external_ids->>'osm',
           'wikidata_id', sd.external_ids->>'wikidata'
         )
  FROM scope_destinations sd
  UNION ALL
  SELECT 2, 'selection', sa.severity,
         sa.destination_id, sa.destination_name,
         sa.route_id, sa.route_name, NULL, NULL, sa.issues,
         JSONB_BUILD_OBJECT(
           'active_route_count', sa.active_route_count,
           'selected_session_count', sa.session_count,
           'selected_one_way_m', ROUND(sa.distance::numeric)
         )
  FROM selection_audit sa
  UNION ALL
  SELECT 3, 'route', ra.severity,
         ra.summit_ids, ra.summit_names,
         ra.id, ra.name, NULL, NULL, ra.issues,
         JSONB_BUILD_OBJECT(
           'status', ra.status,
           'shape', ra.shape,
           'completion', ra.completion,
           'has_valid_provenance',
             COALESCE(is_valid_route_provenance(ra.provenance), false),
           'external_links', ra.external_links,
           'session_count', ra.session_count,
           'trailhead_id', CASE WHEN COALESCE('trailhead'::destination_feature = ANY(ra.first_destination_features), false) THEN ra.first_destination_id END,
           'trailhead', CASE WHEN COALESCE('trailhead'::destination_feature = ANY(ra.first_destination_features), false) THEN ra.first_destination_name END,
           'start_gap_m', CASE WHEN COALESCE('trailhead'::destination_feature = ANY(ra.first_destination_features), false) THEN ROUND(ra.start_destination_gap_m::numeric, 1) END,
           'nearest_trailhead_id', ra.nearest_trailhead_id,
           'nearest_trailhead', ra.nearest_trailhead_name,
           'nearest_trailhead_gap_m', ROUND(ra.nearest_trailhead_gap_m::numeric, 1),
           'summit_id', CASE WHEN COALESCE('summit'::destination_feature = ANY(ra.last_destination_features), false) THEN ra.last_destination_id END,
           'endpoint_summit_gap_m', CASE WHEN ra.shape IN ('out_and_back', 'point_to_point') AND COALESCE('summit'::destination_feature = ANY(ra.last_destination_features), false) THEN ROUND(ra.end_destination_gap_m::numeric, 1) END,
           'worst_summit_gap_m', ROUND(ra.worst_summit_gap_m::numeric, 1),
           'fault_summit_ids', ra.fault_summit_ids,
           'fault_summit_names', ra.fault_summit_names,
           'fault_summit_gaps_m', ra.fault_summit_gaps_m,
           'one_way_m', ROUND(ra.measured_distance_m::numeric),
           'gain_m', ROUND(ra.gain::numeric),
           'gain_loss_m', ROUND(ra.gain_loss::numeric),
           'computed_gain_m', ROUND(ra.computed_gain::numeric),
           'computed_gain_loss_m', ROUND(ra.computed_gain_loss::numeric),
           'elevation_stats_match', ra.gain IS NOT DISTINCT FROM ra.computed_gain
             AND ra.gain_loss IS NOT DISTINCT FROM ra.computed_gain_loss,
           'points', ra.point_count,
           'elevation_profile_matches_path', CASE
             WHEN ra.path IS NULL OR ra.elevation_string IS NULL THEN false
             ELSE ra.elevation_string IS NOT DISTINCT FROM
                  encode_route_elevation_profile(ra.path)
           END,
           'elevation_profile_path_points', ra.point_count,
           'elevation_profile_has_real_range',
             CASE WHEN ra.path IS NULL THEN false
                  ELSE route_elevation_profile_has_real_range(ra.path) END,
           'segments', ra.segment_count,
           'segment_elevation_stats_mismatch_count',
             COALESCE(ra.segment_elevation_stats_mismatch_count, 0),
           'segment_elevation_stats_mismatch_ids',
             COALESCE(ra.segment_elevation_stats_mismatch_ids, '[]'::jsonb),
           'max_step_m', ROUND(ra.max_step_m::numeric, 1),
           'max_segment_gap_m', ROUND(ra.max_segment_gap_m::numeric, 1),
           'route_to_segment_max_m', ROUND(ra.route_to_segment_max_m::numeric, 1),
           'segment_to_route_max_m', ROUND(ra.segment_to_route_max_m::numeric, 1)
         )
  FROM route_audit ra
  UNION ALL
  SELECT 4, 'pair', pa.severity,
         pa.destination_id, pa.destination_name,
         pa.left_id, pa.left_name, pa.right_id, pa.right_name, pa.issues,
         JSONB_BUILD_OBJECT(
           'internal_crossings', pa.internal_crossings,
           'close_overlap_m', ROUND(pa.close_overlap_m::numeric),
           'close_overlap_pct', ROUND((pa.close_overlap_fraction * 100)::numeric, 1),
           'exact_shared_m', ROUND(pa.exact_shared_m::numeric),
           'start_separation_m', ROUND(pa.start_separation_m::numeric),
           'left_trailhead', pa.left_trailhead_name,
           'right_trailhead', pa.right_trailhead_name
         )
  FROM pair_audit pa
)
SQL

if [[ "$format" == "json" ]]; then
  read -r -d '' output_sql <<'SQL' || true
SELECT JSONB_PRETTY(
         JSONB_BUILD_OBJECT(
           'audited_at', now(),
           'records', COALESCE(
             JSONB_AGG(
               JSONB_BUILD_OBJECT(
                 'type', record_type,
                 'severity', severity,
                 'destination_id', destination_id,
                 'destination_name', destination_name,
                 'item_id', item_id,
                 'item_name', item_name,
                 'other_id', other_id,
                 'other_name', other_name,
                 'issues', issues,
                 'metrics', metrics
               ) ORDER BY record_order, destination_name, item_name, other_name
             ),
             '[]'::jsonb
           )
         )
       )
FROM records;
SQL
else
  read -r -d '' output_sql <<'SQL' || true
SELECT record_type, severity, destination_id, destination_name,
       item_id, item_name, other_id, other_name,
       ARRAY_TO_STRING(issues, ' | ') AS issues,
       metrics
  FROM records
ORDER BY record_order, destination_name, item_name, other_name;
SQL
fi

sql="${common_sql}"$'\n'"${output_sql}"
if [[ "$print_sql" == "true" ]]; then
  printf '%s\n' "$sql"
  exit 0
fi

command -v psql >/dev/null 2>&1 || {
  printf '%s\n' "psql is required" >&2
  exit 1
}

db_host="${PEAKS_ROUTE_DB_HOST:-${DB_HOST:-127.0.0.1}}"
db_port="${PEAKS_ROUTE_DB_PORT:-${DB_PORT:-5432}}"
db_name="${PEAKS_ROUTE_DB_NAME:-${DB_NAME:-peaks}}"
db_user="${PEAKS_ROUTE_DB_USER:-${DB_USER:-postgres}}"
db_pass="${PEAKS_ROUTE_DB_PASS:-${DB_PASS:-}}"

if [[ -z "$db_pass" ]]; then
  command -v gcloud >/dev/null 2>&1 || {
    printf '%s\n' "Set PEAKS_ROUTE_DB_PASS or install gcloud" >&2
    exit 1
  }
  db_pass="$(
    gcloud secrets versions access latest \
      --secret=peaks-db-postgres-password \
      --project=donner-a8608 \
      2>/dev/null
  )"
fi
if [[ -z "$db_pass" ]]; then
  printf '%s\n' "Could not load the database password" >&2
  exit 1
fi

psql_flags=("-P" "format=aligned")
if [[ "$format" == "json" ]]; then
  psql_flags=("-t" "-A")
elif [[ "$format" == "tsv" ]]; then
  psql_flags=("-A" "-F" $'\t')
fi

printf '%s\n' "$sql" |
  PGOPTIONS="-c default_transaction_read_only=on -c jit=off -c statement_timeout=300000" \
  PGPASSWORD="$db_pass" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -v destination_id="$destination_id" \
    -v destination_name="$destination_name" \
    -v route_id="$route_id" \
    -v audit_all="$audit_all" \
    -v route_status="$route_status" \
    -v row_limit="$row_limit" \
    -h "$db_host" \
    -p "$db_port" \
    -U "$db_user" \
    -d "$db_name" \
    -P pager=off \
    -P footer=off \
    "${psql_flags[@]}"
