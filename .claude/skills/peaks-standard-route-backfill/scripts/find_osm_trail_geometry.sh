#!/usr/bin/env bash
set -euo pipefail

destination_id=""
radius_m="3000"
output_format="table"

overpass_url="${PEAKS_OVERPASS_URL:-https://overpass-api.de/api/interpreter}"
user_agent="${PEAKS_OVERPASS_USER_AGENT:-Peaks route research/1.0}"
license_url="https://www.openstreetmap.org/copyright"

usage() {
  printf '%s\n' \
    "Usage: $0 --destination-id ID [--radius-m N] [--format table|geojson]" \
    "" \
    "Finds OpenStreetMap trail ways near a Peaks destination." \
    "Cloud SQL is read-only. Results are written to stdout."
}

while (($#)); do
  case "$1" in
    --destination-id)
      destination_id="${2:?--destination-id requires a value}"
      shift 2
      ;;
    --radius-m)
      radius_m="${2:?--radius-m requires a value}"
      shift 2
      ;;
    --format)
      output_format="${2:?--format requires a value}"
      shift 2
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

if [[ -z "$destination_id" ]]; then
  printf '%s\n' "--destination-id is required" >&2
  exit 2
fi

if ! [[ "$destination_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf '%s\n' "--destination-id contains unsupported characters" >&2
  exit 2
fi

if ! [[ "$radius_m" =~ ^[1-9][0-9]*$ ]] || ((radius_m > 20000)); then
  printf '%s\n' "--radius-m must be an integer from 1 to 20000" >&2
  exit 2
fi

if [[ "$output_format" != "table" && "$output_format" != "geojson" ]]; then
  printf '%s\n' "--format must be table or geojson" >&2
  exit 2
fi

for command_name in psql curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '%s\n' "$command_name is required" >&2
    exit 1
  }
done

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

destination_row="$(
  printf '%s\n' "
      SELECT name,
             ST_Y(location::geometry),
             ST_X(location::geometry)
      FROM destinations
      WHERE id = :'destination_id';
    " |
    PGOPTIONS="-c default_transaction_read_only=on" \
    PGPASSWORD="$db_pass" \
    psql \
      -X \
      -q \
      -t \
      -A \
      -F $'\t' \
      -v ON_ERROR_STOP=1 \
      -v destination_id="$destination_id" \
      -h "$db_host" \
      -p "$db_port" \
      -U "$db_user" \
      -d "$db_name"
)"

if [[ -z "$destination_row" ]]; then
  printf 'Destination not found: %s\n' "$destination_id" >&2
  exit 1
fi

IFS=$'\t' read -r destination_name latitude longitude <<<"$destination_row"

overpass_query="[out:json][timeout:25];way(around:${radius_m},${latitude},${longitude})[\"highway\"~\"^(path|footway|track)$\"];out tags geom;"

response="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --retry 2 \
    --max-time 45 \
    --user-agent "$user_agent" \
    --data "data=${overpass_query}" \
    "$overpass_url"
)"

if jq -e '.remark != null' >/dev/null <<<"$response"; then
  jq -r '.remark' <<<"$response" >&2
  exit 1
fi

printf 'Destination: %s (%s)\n' "$destination_name" "$destination_id" >&2
printf 'Center: %s, %s; radius: %s m\n' "$latitude" "$longitude" "$radius_m" >&2
printf 'Source: %s\n' "$overpass_url" >&2
printf 'License: OpenStreetMap contributors, ODbL; %s\n' "$license_url" >&2

if [[ "$output_format" == "geojson" ]]; then
  jq \
    --arg destination_id "$destination_id" \
    --arg destination_name "$destination_name" \
    --arg source "$overpass_url" \
    --arg license "$license_url" \
    '{
      type: "FeatureCollection",
      peaks_destination_id: $destination_id,
      peaks_destination_name: $destination_name,
      peaks_source: $source,
      peaks_license: $license,
      features: [
        .elements[]
        | select(.type == "way" and (.geometry | length) > 1)
        | {
            type: "Feature",
            id: ("way/" + (.id | tostring)),
            properties: (
              (.tags // {})
              + {
                  osm_type: "way",
                  osm_id: .id,
                  osm_url: ("https://www.openstreetmap.org/way/" + (.id | tostring))
                }
            ),
            geometry: {
              type: "LineString",
              coordinates: [.geometry[] | [.lon, .lat]]
            }
          }
      ]
    }' <<<"$response"
  exit 0
fi

printf '%s\n' \
  $'way_id\tname\thighway\tsac_scale\ttrail_visibility\tsurface\tosm_url'

jq -r '
  .elements
  | map(select(.type == "way"))
  | sort_by((.tags.name // ""), .id)
  | .[]
  | [
      .id,
      (.tags.name // ""),
      (.tags.highway // ""),
      (.tags.sac_scale // ""),
      (.tags.trail_visibility // ""),
      (.tags.surface // ""),
      ("https://www.openstreetmap.org/way/" + (.id | tostring))
    ]
  | @tsv
' <<<"$response"
