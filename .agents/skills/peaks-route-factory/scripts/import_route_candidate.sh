#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

export PEAKS_ELEVATION_SOURCE="terrain-cache"
export PEAKS_TERRAIN_TILE_CACHE="/private/tmp/peaks-route-worker/terrain"

exec "$script_dir/with_route_db.sh" \
  "$repo_root/cloud-sql/migrate/scripts/run-tsx.sh" \
  "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts" \
  "$@"
