#!/usr/bin/env bash
set -euo pipefail

format="summary"
incomplete_only="false"
require_complete="false"
row_limit="0"
print_sql="false"

usage() {
  printf '%s\n' \
    "Usage: $0 [--format summary|tsv|json] [--incomplete-only] [--limit N]" \
    "          [--require-complete] [--print-sql]" \
    "" \
    "Audits route and cover-photo completeness for every destination on a" \
    "Peaks-owned list and every active Peaks route linked to those destinations." \
    "" \
    "A destination is complete only when it is a summit, has a fully credited" \
    "cover, has a publish-valid active standard route with a derived cover, and" \
    "none of its active Peaks routes lacks a derived cover." \
    "" \
    "--require-complete is valid with summary output and exits 1 on any gap." \
    "The route_cover_photos view migration must be applied before this audit."
}

while (($#)); do
  case "$1" in
    --format)
      format="${2:?--format requires a value}"
      shift 2
      ;;
    --incomplete-only)
      incomplete_only="true"
      shift
      ;;
    --require-complete)
      require_complete="true"
      shift
      ;;
    --limit)
      row_limit="${2:?--limit requires a value}"
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

if [[ "$format" != "summary" && "$format" != "tsv" && "$format" != "json" ]]; then
  printf '%s\n' "--format must be summary, tsv, or json" >&2
  exit 2
fi
if ! [[ "$row_limit" =~ ^[0-9]+$ ]]; then
  printf '%s\n' "--limit must be a non-negative integer" >&2
  exit 2
fi
if [[ "$require_complete" == "true" && "$format" != "summary" ]]; then
  printf '%s\n' "--require-complete requires --format summary" >&2
  exit 2
fi

read -r -d '' common_sql <<'SQL' || true
WITH listed_destinations AS (
  SELECT d.id,
         d.name,
         d.state_code,
         d.country_code,
         d.elevation,
         d.prominence,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lng,
         ARRAY_AGG(DISTINCT l.name ORDER BY l.name) AS list_names,
         'summit'::destination_feature = ANY(d.features)
           AS summit_feature_valid,
         NULLIF(BTRIM(d.hero_image), '') IS NOT NULL
           AND NULLIF(BTRIM(d.hero_image_attribution), '') IS NOT NULL
           AND NULLIF(BTRIM(d.hero_image_attribution_url), '') IS NOT NULL
           AS destination_cover_complete
  FROM destinations d
  JOIN list_destinations ld ON ld.destination_id = d.id
  JOIN lists l ON l.id = ld.list_id
  WHERE l.owner = 'peaks'
  GROUP BY d.id
),
route_links AS (
  SELECT listed.id AS destination_id,
         r.id AS route_id,
         r.name AS route_name,
         r.owner = 'peaks' AND r.status = 'active'
           AS active_peaks_route,
         CASE
           WHEN r.owner = 'peaks' AND r.status = 'active'
             THEN peaks_route_passes_publish_integrity(
               r.id, listed.id, 'active'
             )
           ELSE false
         END AS valid_active_peaks_route,
         cover.route_id IS NOT NULL AS route_cover_complete
  FROM listed_destinations listed
  LEFT JOIN route_destinations rd ON rd.destination_id = listed.id
  LEFT JOIN routes r ON r.id = rd.route_id
  LEFT JOIN route_cover_photos cover ON cover.route_id = r.id
),
route_evidence AS (
  SELECT destination_id,
         COUNT(DISTINCT route_id)
           FILTER (WHERE active_peaks_route) AS active_peaks_routes,
         COUNT(DISTINCT route_id)
           FILTER (WHERE valid_active_peaks_route)
           AS valid_active_peaks_routes,
         COUNT(DISTINCT route_id)
           FILTER (
             WHERE valid_active_peaks_route AND route_cover_complete
           ) AS valid_active_peaks_routes_with_cover,
         COUNT(DISTINCT route_id)
           FILTER (
             WHERE active_peaks_route AND NOT route_cover_complete
           ) AS active_peaks_routes_without_cover,
         COALESCE(
           ARRAY_AGG(DISTINCT route_id ORDER BY route_id)
             FILTER (
               WHERE active_peaks_route AND NOT route_cover_complete
             ),
           '{}'::text[]
         ) AS route_ids_without_cover
  FROM route_links
  GROUP BY destination_id
),
goal_rows AS (
  SELECT listed.*,
         COALESCE(evidence.active_peaks_routes, 0)
           AS active_peaks_routes,
         COALESCE(evidence.valid_active_peaks_routes, 0)
           AS valid_active_peaks_routes,
         COALESCE(evidence.valid_active_peaks_routes_with_cover, 0)
           AS valid_active_peaks_routes_with_cover,
         COALESCE(evidence.active_peaks_routes_without_cover, 0)
           AS active_peaks_routes_without_cover,
         COALESCE(evidence.route_ids_without_cover, '{}'::text[])
           AS route_ids_without_cover,
         COALESCE(evidence.valid_active_peaks_routes, 0) > 0
           AS has_standard_route,
         COALESCE(evidence.valid_active_peaks_routes_with_cover, 0) > 0
           AS has_standard_route_cover,
         listed.summit_feature_valid
           AND listed.destination_cover_complete
           AND COALESCE(
             evidence.valid_active_peaks_routes_with_cover,
             0
           ) > 0
           AND COALESCE(evidence.active_peaks_routes_without_cover, 0) = 0
           AS listed_route_cover_complete
  FROM listed_destinations listed
  LEFT JOIN route_evidence evidence
    ON evidence.destination_id = listed.id
),
listed_routes AS (
  SELECT route_id,
         MIN(route_name) AS route_name,
         BOOL_OR(route_cover_complete) AS route_cover_complete
  FROM route_links
  WHERE active_peaks_route
  GROUP BY route_id
)
SQL

if [[ "$format" == "summary" ]]; then
  read -r -d '' output_sql <<'SQL' || true
SELECT COUNT(*) AS listed_destinations,
       COUNT(*) FILTER (WHERE destination_cover_complete)
         AS with_destination_cover,
       COUNT(*) FILTER (WHERE NOT destination_cover_complete)
         AS missing_destination_cover,
       COUNT(*) FILTER (WHERE has_standard_route) AS with_standard_route,
       COUNT(*) FILTER (WHERE NOT has_standard_route)
         AS missing_standard_route,
       COUNT(*) FILTER (WHERE has_standard_route_cover)
         AS with_standard_route_cover,
       COUNT(*) FILTER (WHERE NOT has_standard_route_cover)
         AS missing_standard_route_cover,
       COUNT(*) FILTER (WHERE NOT summit_feature_valid)
         AS listed_data_blockers,
       COUNT(*) FILTER (WHERE listed_route_cover_complete)
         AS complete_listed_destinations,
       COUNT(*) FILTER (WHERE NOT listed_route_cover_complete)
         AS incomplete_listed_destinations,
       (SELECT COUNT(*) FROM listed_routes) AS active_listed_routes,
       (SELECT COUNT(*) FROM listed_routes WHERE route_cover_complete)
         AS active_listed_routes_with_cover,
       (SELECT COUNT(*) FROM listed_routes WHERE NOT route_cover_complete)
         AS active_listed_routes_missing_cover,
       COUNT(*) FILTER (WHERE NOT listed_route_cover_complete) = 0
         AND NOT EXISTS (
           SELECT 1 FROM listed_routes WHERE NOT route_cover_complete
         ) AS goal_complete
FROM goal_rows;
SQL
elif [[ "$format" == "json" ]]; then
  read -r -d '' output_sql <<'SQL' || true
SELECT COALESCE(
         JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'destination_id', id,
             'name', name,
             'state_code', state_code,
             'country_code', country_code,
             'elevation_m', elevation,
             'prominence_m', prominence,
             'lat', lat,
             'lng', lng,
             'list_names', list_names,
             'summit_feature_valid', summit_feature_valid,
             'destination_cover_complete', destination_cover_complete,
             'has_standard_route', has_standard_route,
             'has_standard_route_cover', has_standard_route_cover,
             'active_peaks_routes', active_peaks_routes,
             'valid_active_peaks_routes', valid_active_peaks_routes,
             'valid_active_peaks_routes_with_cover',
               valid_active_peaks_routes_with_cover,
             'active_peaks_routes_without_cover',
               active_peaks_routes_without_cover,
             'route_ids_without_cover', route_ids_without_cover,
             'listed_route_cover_complete', listed_route_cover_complete
           )
           ORDER BY listed_route_cover_complete, name, id
         ),
         '[]'::jsonb
       )
FROM (
  SELECT *
  FROM goal_rows
  WHERE NOT :'incomplete_only'::boolean
     OR NOT listed_route_cover_complete
  ORDER BY listed_route_cover_complete, name, id
  LIMIT NULLIF(:'row_limit', '0')::integer
) rows;
SQL
else
  read -r -d '' output_sql <<'SQL' || true
SELECT id AS destination_id,
       name,
       country_code,
       state_code,
       ROUND((elevation * 3.28084)::numeric) AS elevation_ft,
       ROUND((prominence * 3.28084)::numeric) AS prominence_ft,
       ARRAY_TO_STRING(list_names, ' | ') AS list_names,
       summit_feature_valid,
       destination_cover_complete,
       has_standard_route,
       has_standard_route_cover,
       active_peaks_routes,
       valid_active_peaks_routes,
       valid_active_peaks_routes_with_cover,
       active_peaks_routes_without_cover,
       ARRAY_TO_STRING(route_ids_without_cover, ' | ')
         AS route_ids_without_cover,
       listed_route_cover_complete,
       ROUND(lat::numeric, 6) AS lat,
       ROUND(lng::numeric, 6) AS lng
FROM goal_rows
WHERE NOT :'incomplete_only'::boolean
   OR NOT listed_route_cover_complete
ORDER BY listed_route_cover_complete, name, id
LIMIT NULLIF(:'row_limit', '0')::integer;
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

psql_extra_flag=""
if [[ "$format" == "json" ]]; then
  psql_extra_flag="-t"
fi

result="$(
  printf '%s\n' "$sql" |
    PGOPTIONS="-c default_transaction_read_only=on" \
    PGPASSWORD="$db_pass" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -v incomplete_only="$incomplete_only" \
      -v row_limit="$row_limit" \
      -h "$db_host" \
      -p "$db_port" \
      -U "$db_user" \
      -d "$db_name" \
      -P pager=off \
      -P footer=off \
      -A \
      -F $'\t' \
      ${psql_extra_flag:+"$psql_extra_flag"}
)"
printf '%s\n' "$result"

if [[ "$require_complete" == "true" ]]; then
  audit_complete="${result##*$'\t'}"
  if [[ "$audit_complete" != "t" ]]; then
    printf '%s\n' "Listed route and cover-photo goal is incomplete" >&2
    exit 1
  fi
fi
