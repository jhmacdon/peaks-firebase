#!/usr/bin/env bash
set -euo pipefail

state_code="WA"
state_requested="false"
worldwide="false"
list_filter=""
row_limit="0"
print_sql="false"
coverage_only="false"

usage() {
  printf '%s\n' \
    "Usage: $0 [--state WA | --worldwide] [--list NAME_OR_ID] [--limit N]" \
    "          [--coverage] [--print-sql]" \
    "" \
    "Audits Cloud SQL for listed destinations with no valid active Peaks-owned route." \
    "The default scope is Washington. Use --worldwide for every Peaks-owned list." \
    "Output is tab-separated and the database session is forced read-only."
}

while (($#)); do
  case "$1" in
    --state)
      state_code="${2:?--state requires a value}"
      state_requested="true"
      shift 2
      ;;
    --worldwide)
      worldwide="true"
      shift
      ;;
    --list)
      list_filter="${2:?--list requires a value}"
      shift 2
      ;;
    --limit)
      row_limit="${2:?--limit requires a value}"
      shift 2
      ;;
    --print-sql)
      print_sql="true"
      shift
      ;;
    --coverage)
      coverage_only="true"
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

if [[ "$state_requested" == "true" && "$worldwide" == "true" ]]; then
  printf '%s\n' "Choose either --state or --worldwide" >&2
  exit 2
fi

if ! [[ "$state_code" =~ ^[A-Za-z]{2}$ ]]; then
  printf '%s\n' "--state must be a two-letter code" >&2
  exit 2
fi
state_code="$(printf '%s' "$state_code" | tr '[:lower:]' '[:upper:]')"

if ! [[ "$row_limit" =~ ^[0-9]+$ ]]; then
  printf '%s\n' "--limit must be a non-negative integer" >&2
  exit 2
fi

read -r -d '' sql <<'SQL' || true
WITH memberships AS (
  SELECT d.id,
         d.name,
         d.elevation,
         'summit'::destination_feature = ANY(d.features)
           AS summit_feature_valid,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lng,
         l.id AS list_id,
         l.name AS list_name
  FROM destinations d
  JOIN list_destinations ld ON ld.destination_id = d.id
  JOIN lists l ON l.id = ld.list_id
  WHERE (:'worldwide'::boolean OR d.state_code = :'state_code')
    AND l.owner = 'peaks'
    AND (
      :'list_filter' = ''
      OR EXISTS (
        SELECT 1
        FROM list_destinations filter_ld
        JOIN lists filter_l ON filter_l.id = filter_ld.list_id
        WHERE filter_ld.destination_id = d.id
          AND filter_l.owner = 'peaks'
          AND (
            filter_l.id = :'list_filter'
            OR filter_l.name ILIKE '%' || :'list_filter' || '%'
          )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM route_destinations current_rd
      JOIN routes current_r ON current_r.id = current_rd.route_id
      WHERE current_rd.destination_id = d.id
        AND current_r.owner = 'peaks'
        AND current_r.status = 'active'
        AND peaks_route_passes_publish_integrity(
          current_r.id, d.id, 'active'
        )
    )
),
route_evidence AS (
  SELECT rd.destination_id,
         COUNT(DISTINCT r.id)
           FILTER (WHERE r.owner = 'peaks' AND r.status = 'active')
           AS active_peaks_routes,
         COUNT(DISTINCT r.id)
           FILTER (WHERE r.owner = 'peaks' AND r.status = 'pending')
           AS pending_peaks_routes,
         COUNT(DISTINCT r.id)
           FILTER (WHERE r.owner <> 'peaks')
           AS user_routes,
         COUNT(DISTINCT sr.session_id)
           FILTER (WHERE r.owner <> 'peaks')
           AS user_route_sessions,
         STRING_AGG(
           DISTINCT CASE
             WHEN r.owner <> 'peaks' THEN COALESCE(r.name, r.id)
           END,
           ' | '
         ) AS user_route_names
  FROM route_destinations rd
  JOIN routes r ON r.id = rd.route_id
  LEFT JOIN session_routes sr ON sr.route_id = r.id
  GROUP BY rd.destination_id
),
candidates AS (
  SELECT m.id AS destination_id,
         m.name AS destination_name,
         ROUND((m.elevation * 3.28084)::numeric) AS elevation_ft,
         m.summit_feature_valid,
         ROUND(m.lat::numeric, 6) AS lat,
         ROUND(m.lng::numeric, 6) AS lng,
         COUNT(DISTINCT m.list_id) AS list_count,
         STRING_AGG(DISTINCT m.list_id, ' | ' ORDER BY m.list_id) AS list_ids,
         STRING_AGG(DISTINCT m.list_name, ' | ' ORDER BY m.list_name) AS list_names,
         COALESCE(re.active_peaks_routes, 0) AS active_peaks_routes,
         COALESCE(re.pending_peaks_routes, 0) AS pending_peaks_routes,
         COALESCE(re.user_routes, 0) AS user_routes,
         COALESCE(re.user_route_sessions, 0) AS user_route_sessions,
         COALESCE(re.user_route_names, '') AS user_route_names
  FROM memberships m
  LEFT JOIN route_evidence re ON re.destination_id = m.id
  GROUP BY m.id, m.name, m.elevation, m.summit_feature_valid, m.lat, m.lng,
           re.active_peaks_routes, re.pending_peaks_routes, re.user_routes,
           re.user_route_sessions, re.user_route_names
)
SELECT destination_id,
       destination_name,
       elevation_ft,
       summit_feature_valid,
       lat,
       lng,
       list_count,
       list_ids,
       list_names,
       active_peaks_routes,
       pending_peaks_routes,
       user_routes,
       user_route_sessions,
       user_route_names
FROM candidates
ORDER BY (NOT summit_feature_valid) DESC,
         (user_routes > 0) DESC,
         user_route_sessions DESC,
         list_count DESC,
         destination_name,
         destination_id
LIMIT NULLIF(:'row_limit', '0')::integer;
SQL

if [[ "$coverage_only" == "true" ]]; then
  read -r -d '' sql <<'SQL' || true
WITH list_rows AS (
  SELECT l.id AS list_id,
         l.name AS list_name,
         d.id AS destination_id,
         'summit'::destination_feature = ANY(d.features)
           AS summit_feature_valid,
         EXISTS (
           SELECT 1
           FROM route_destinations rd
           JOIN routes r ON r.id = rd.route_id
           WHERE rd.destination_id = d.id
             AND r.owner = 'peaks'
             AND r.status = 'active'
             AND peaks_route_passes_publish_integrity(
               r.id, d.id, 'active'
             )
         ) AS has_standard_route
  FROM lists l
  JOIN list_destinations ld ON ld.list_id = l.id
  JOIN destinations d ON d.id = ld.destination_id
  WHERE l.owner = 'peaks'
    AND (:'worldwide'::boolean OR d.state_code = :'state_code')
    AND (
      :'list_filter' = ''
      OR l.id = :'list_filter'
      OR l.name ILIKE '%' || :'list_filter' || '%'
    )
)
SELECT list_id,
       list_name,
       COUNT(*) AS destinations,
       COUNT(*) FILTER (WHERE NOT summit_feature_valid)
         AS listed_data_blockers,
       COUNT(*) FILTER (WHERE has_standard_route) AS with_standard_route,
       COUNT(*) FILTER (WHERE NOT has_standard_route) AS missing_standard_route,
       ROUND(
         100.0 * COUNT(*) FILTER (WHERE has_standard_route) / COUNT(*),
         1
       ) AS coverage_pct
FROM list_rows
GROUP BY list_id, list_name
ORDER BY missing_standard_route DESC, list_name, list_id;
SQL
fi

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

printf '%s\n' "$sql" |
  PGOPTIONS="-c default_transaction_read_only=on" \
  PGPASSWORD="$db_pass" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -v state_code="$state_code" \
    -v worldwide="$worldwide" \
    -v list_filter="$list_filter" \
    -v row_limit="$row_limit" \
    -h "$db_host" \
    -p "$db_port" \
    -U "$db_user" \
    -d "$db_name" \
    -P pager=off \
    -P footer=off \
    -A \
    -F $'\t'
