#!/usr/bin/env bash
set -euo pipefail

format="summary"
missing_only="false"
row_limit="0"
popularity_threshold="25"
print_sql="false"

usage() {
  printf '%s\n' \
    "Usage: $0 [--format summary|tsv|json] [--missing-only] [--limit N]" \
    "          [--popularity-threshold N] [--print-sql]" \
    "" \
    "Audits the complete standard-route goal against Cloud SQL." \
    "The target set is the union of:" \
    "  - every summit with at least 1,500 m prominence;" \
    "  - every destination on any Peaks-owned list; and" \
    "  - every summit at or above the popularity threshold." \
    "" \
    "A standard route must be Peaks-owned, active, and pass publish integrity." \
    "A listed destination without the summit feature remains a visible data blocker."
}

while (($#)); do
  case "$1" in
    --format)
      format="${2:?--format requires a value}"
      shift 2
      ;;
    --missing-only)
      missing_only="true"
      shift
      ;;
    --limit)
      row_limit="${2:?--limit requires a value}"
      shift 2
      ;;
    --popularity-threshold)
      popularity_threshold="${2:?--popularity-threshold requires a value}"
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
if ! [[ "$popularity_threshold" =~ ^[0-9]+$ ]] || ((popularity_threshold < 1)); then
  printf '%s\n' "--popularity-threshold must be a positive integer" >&2
  exit 2
fi

read -r -d '' common_sql <<'SQL' || true
WITH destination_popularity AS (
  SELECT d.id,
         d.session_count_offset + COUNT(sd.session_id) AS session_count,
         d.success_count_offset
           + COUNT(sd.session_id) FILTER (WHERE sd.relation = 'reached')
           AS success_count
  FROM destinations d
  LEFT JOIN session_destinations sd ON sd.destination_id = d.id
  GROUP BY d.id
),
target_reasons AS (
  SELECT d.id,
         d.name,
         d.state_code,
         d.country_code,
         d.elevation,
         d.prominence,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lng,
         p.session_count,
         p.success_count,
         COALESCE(
           ARRAY_AGG(DISTINCT l.name ORDER BY l.name)
             FILTER (WHERE l.owner = 'peaks'),
           '{}'
         ) AS list_names,
         'summit'::destination_feature = ANY(d.features)
           AS summit_feature_valid,
         'summit'::destination_feature = ANY(d.features)
           AND d.prominence >= 1500 AS is_ultra_prominent,
         COALESCE(
           BOOL_OR(l.owner = 'peaks'),
           false
         ) AS is_target_list,
         'summit'::destination_feature = ANY(d.features)
           AND p.session_count >= :'popularity_threshold'::integer
           AS is_high_popularity
  FROM destinations d
  JOIN destination_popularity p ON p.id = d.id
  LEFT JOIN list_destinations ld ON ld.destination_id = d.id
  LEFT JOIN lists l ON l.id = ld.list_id
  GROUP BY d.id, p.session_count, p.success_count
),
targets AS (
  SELECT *
  FROM target_reasons
  WHERE is_ultra_prominent OR is_target_list OR is_high_popularity
),
route_evidence AS (
  SELECT t.id AS destination_id,
         COUNT(DISTINCT r.id)
           FILTER (WHERE r.owner = 'peaks' AND r.status = 'active')
           AS active_peaks_routes,
         COUNT(DISTINCT r.id)
           FILTER (
             WHERE r.owner = 'peaks'
               AND r.status = 'active'
               AND peaks_route_passes_publish_integrity(
                 r.id, t.id, 'active'
               )
           ) AS valid_active_peaks_routes,
         COUNT(DISTINCT r.id)
           FILTER (WHERE r.owner = 'peaks' AND r.status = 'pending')
           AS pending_peaks_routes,
         COUNT(DISTINCT r.id)
           FILTER (WHERE r.owner <> 'peaks')
           AS user_routes,
         COUNT(DISTINCT sr.session_id)
           FILTER (WHERE r.owner <> 'peaks')
           AS user_route_sessions
  FROM targets t
  LEFT JOIN route_destinations rd ON rd.destination_id = t.id
  LEFT JOIN routes r ON r.id = rd.route_id
  LEFT JOIN session_routes sr ON sr.route_id = r.id
  GROUP BY t.id
),
goal_rows AS (
  SELECT t.*,
         COALESCE(re.active_peaks_routes, 0) AS active_peaks_routes,
         COALESCE(re.valid_active_peaks_routes, 0)
           AS valid_active_peaks_routes,
         COALESCE(re.pending_peaks_routes, 0) AS pending_peaks_routes,
         COALESCE(re.user_routes, 0) AS user_routes,
         COALESCE(re.user_route_sessions, 0) AS user_route_sessions,
         COALESCE(re.valid_active_peaks_routes, 0) > 0 AS has_standard_route
  FROM targets t
  LEFT JOIN route_evidence re ON re.destination_id = t.id
)
SQL

if [[ "$format" == "summary" ]]; then
  read -r -d '' output_sql <<'SQL' || true
SELECT COUNT(*) AS targets,
       COUNT(*) FILTER (WHERE has_standard_route) AS with_standard_route,
       COUNT(*) FILTER (WHERE NOT has_standard_route) AS missing_standard_route,
       COUNT(*) FILTER (WHERE is_ultra_prominent) AS ultra_prominent,
       COUNT(*) FILTER (WHERE is_target_list) AS curated_list,
       COUNT(*) FILTER (
         WHERE is_target_list AND NOT summit_feature_valid
       ) AS listed_data_blockers,
       COUNT(*) FILTER (WHERE is_high_popularity) AS high_popularity,
       COUNT(*) FILTER (
         WHERE NOT has_standard_route AND pending_peaks_routes > 0
       ) AS pending_only
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
             'session_count', session_count,
             'success_count', success_count,
             'list_names', list_names,
             'summit_feature_valid', summit_feature_valid,
             'is_ultra_prominent', is_ultra_prominent,
             'is_target_list', is_target_list,
             'is_high_popularity', is_high_popularity,
             'has_standard_route', has_standard_route,
             'active_peaks_routes', active_peaks_routes,
             'valid_active_peaks_routes', valid_active_peaks_routes,
             'pending_peaks_routes', pending_peaks_routes,
             'user_routes', user_routes,
             'user_route_sessions', user_route_sessions
           )
           ORDER BY has_standard_route, session_count DESC, name, id
         ),
         '[]'::jsonb
       )
FROM (
  SELECT *
  FROM goal_rows
  WHERE NOT :'missing_only'::boolean OR NOT has_standard_route
  ORDER BY has_standard_route, session_count DESC, name, id
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
       session_count,
       success_count,
       ARRAY_TO_STRING(list_names, ' | ') AS list_names,
       summit_feature_valid,
       is_ultra_prominent,
       is_target_list,
       is_high_popularity,
       has_standard_route,
       active_peaks_routes,
       valid_active_peaks_routes,
       pending_peaks_routes,
       user_routes,
       user_route_sessions,
       ROUND(lat::numeric, 6) AS lat,
       ROUND(lng::numeric, 6) AS lng
FROM goal_rows
WHERE NOT :'missing_only'::boolean OR NOT has_standard_route
ORDER BY has_standard_route, session_count DESC, name, id
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

printf '%s\n' "$sql" |
  PGOPTIONS="-c default_transaction_read_only=on" \
  PGPASSWORD="$db_pass" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -v popularity_threshold="$popularity_threshold" \
    -v missing_only="$missing_only" \
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
