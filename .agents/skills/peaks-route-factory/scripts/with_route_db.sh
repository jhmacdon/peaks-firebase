#!/bin/bash -p
set -euo pipefail
set +x

if [[ "$#" -eq 0 ]]; then
  printf '%s\n' "with_route_db.sh requires a command" >&2
  exit 2
fi

initial_script_dir="${BASH_SOURCE[0]%/*}"
if [[ "$initial_script_dir" == "${BASH_SOURCE[0]}" ]]; then
  initial_script_dir="$PWD"
elif [[ "$initial_script_dir" != /* ]]; then
  initial_script_dir="$PWD/$initial_script_dir"
fi
builtin source "$initial_script_dir/route_worker_environment.sh"
sanitize_route_worker_environment

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/../../../.." && pwd -P)"
checkout_kind="$("$script_dir/resolve_worker_checkout.sh" "$repo_root")"
worker_artifact_relative_root="cloud-sql/migrate/route-candidates/luna/worker-artifacts"
worker_artifact_root="$repo_root/$worker_artifact_relative_root"
worker_system_tmp="$(select_route_worker_system_tmp /private/tmp /tmp)"
export TMPDIR="$worker_system_tmp"
export TMP="$worker_system_tmp"
export TEMP="$worker_system_tmp"
worker_cache_root="$worker_system_tmp/peaks-route-worker"
worker_map_tile_root="$worker_cache_root/osm-map-tiles"
worker_terrain_root="$worker_cache_root/terrain"
worker_reference_root="$worker_cache_root/references"
umask 077

unset selected_database_password
selected_database_password=""
case "$checkout_kind" in
  route-factory|route-factory-02|route-factory-03|route-factory-04|route-repair)
    credential_profile="factory"
    database_user="peaks-route-factory-worker"
    selected_database_password="${PEAKS_ROUTE_FACTORY_DB_PASS:-}"
    unset PEAKS_ROUTE_FACTORY_DB_USER PEAKS_ROUTE_REVIEW_DB_USER
    unset PEAKS_ROUTE_REVIEW_DB_PASS PEAKS_ROUTE_DB_PASS
    ;;
  route-review)
    credential_profile="reviewer"
    database_user="peaks-route-reviewer-worker"
    selected_database_password="${PEAKS_ROUTE_REVIEW_DB_PASS:-}"
    unset PEAKS_ROUTE_FACTORY_DB_USER PEAKS_ROUTE_REVIEW_DB_USER
    unset PEAKS_ROUTE_FACTORY_DB_PASS PEAKS_ROUTE_DB_PASS
    ;;
  *)
    credential_profile="operator"
    database_user="${PEAKS_ROUTE_DB_USER:-${DB_USER:-postgres}}"
    selected_database_password="${PEAKS_ROUTE_DB_PASS:-${DB_PASS:-}}"
    ;;
esac

if [[ "$credential_profile" != "operator" ]]; then
  unset DATABASE_URL PGPASSWORD PGSERVICE PGSERVICEFILE PGUSER PGHOST PGPORT PGDATABASE
  unset PEAKS_ROUTE_DB_USER DB_USER
  unset PEAKS_ELEVATION_SOURCE PEAKS_TERRAIN_TILE_CACHE
  unset PEAKS_ELEVATION_CACHE_DIR
fi
unset DB_PASS PEAKS_ROUTE_FACTORY_DB_PASS PEAKS_ROUTE_REVIEW_DB_PASS PEAKS_ROUTE_DB_PASS
configure_route_database_target "$credential_profile"
"$script_dir/worker_preflight.sh" >/dev/null

worker_command_path() {
  local value="$1"
  case "$value" in
    "$repo_root"/*) printf '%s\n' "$value" ;;
    cloud-sql/*|.agents/*|.claude/*) printf '%s\n' "$repo_root/$value" ;;
    *) return 1 ;;
  esac
}

resolved_worker_command=("$@")
approved_worker_script=""
worker_argument_start=0
worker_requires_database=1

require_worker_command() {
  if [[ "$credential_profile" == "operator" ]]; then
    return 0
  fi

  local executable
  executable="$(worker_command_path "${1:-}")" || {
    printf '%s\n' "Worker database wrapper rejected an unapproved command" >&2
    exit 2
  }
  local runner="$repo_root/cloud-sql/migrate/scripts/run-tsx.sh"
  if [[ "$executable" == "$runner" ]]; then
    local script
    script="$(worker_command_path "${2:-}")" || {
      printf '%s\n' "Worker database wrapper rejected an unapproved script" >&2
      exit 2
    }
    case "$credential_profile:$script" in
      factory:"$repo_root/cloud-sql/migrate/src/standard-route-jobs.ts"|\
      reviewer:"$repo_root/cloud-sql/migrate/src/standard-route-jobs.ts"|\
      factory:"$repo_root/.agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/find_official_trail_geometry.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/build_official_route_candidate.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/build_usgs_route_candidate.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/merge_osm_loop_candidates.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/merge_route_loop_candidates.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/compare_route_reference.mts"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"|\
      reviewer:"$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts"|\
      reviewer:"$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"|\
      reviewer:"$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts")
        resolved_worker_command=("$runner" "$script" "${@:3}")
        approved_worker_script="$script"
        worker_argument_start=2
        return 0
        ;;
    esac
  else
    case "$credential_profile:$executable" in
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/find_public_trail_geometry.sh"|\
      factory:"$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.sh")
        resolved_worker_command=("$executable" "${@:2}")
        approved_worker_script="$executable"
        worker_argument_start=1
        return 0
        ;;
    esac
  fi
  printf '%s\n' "Worker database wrapper rejected an unapproved command" >&2
  exit 2
}

require_worker_command "$@"

reject_worker_path() {
  printf '%s\n' "$1" >&2
  exit 2
}

ensure_worker_directory() {
  local directory="$1"
  local canonical_directory
  local ancestor="$directory"
  if [[ "$directory" == "$worker_cache_root"/* ]]; then
    ensure_worker_directory "$worker_cache_root"
  fi
  while [[ "$ancestor" != "/" ]]; do
    if [[ -L "$ancestor" ]]; then
      reject_worker_path "Worker paths must not use symlinked storage roots"
    fi
    ancestor="${ancestor%/*}"
    [[ -n "$ancestor" ]] || ancestor="/"
  done
  mkdir -p "$directory"
  if [[ ! -d "$directory" || -L "$directory" ]]; then
    reject_worker_path "Worker storage root is not a real directory"
  fi
  if [[ "$directory" == "$worker_cache_root" ||
        "$directory" == "$worker_cache_root"/* ]]; then
    if [[ ! -O "$directory" ]]; then
      reject_worker_path "Worker cache roots must belong to the worker account"
    fi
    if ! chmod 700 "$directory"; then
      reject_worker_path "Worker cache roots must be private"
    fi
  fi
  canonical_directory="$(cd "$directory" && pwd -P)"
  if [[ "$canonical_directory" != "$directory" ]]; then
    reject_worker_path "Worker paths must not traverse symlinked storage roots"
  fi
}

ensure_worker_tree_without_symlinks() {
  local directory="$1"
  ensure_worker_directory "$directory"
  if [[ -n "$(find -P "$directory" -type l -print -quit)" ]]; then
    reject_worker_path "Worker cache and directory inputs must not contain symlinks"
  fi
}

bind_worker_file_flags() {
  local flag="$1"
  local root="$2"
  local access_mode="$3"
  local index value resolved relative
  for ((index = worker_argument_start; index < ${#resolved_worker_command[@]}; index++)); do
    if [[ "${resolved_worker_command[$index]}" == "$flag="* ]]; then
      reject_worker_path "$flag requires a separate path value"
    fi
    if [[ "${resolved_worker_command[$index]}" != "$flag" ]]; then
      continue
    fi
    if ((index + 1 >= ${#resolved_worker_command[@]})) ||
       [[ "${resolved_worker_command[$((index + 1))]}" == --* ]]; then
      reject_worker_path "$flag requires one path"
    fi
    value="${resolved_worker_command[$((index + 1))]}"
    case "$value" in
      "$root"/*)
        resolved="$value"
        ;;
      "$worker_artifact_relative_root"/*)
        if [[ "$root" != "$worker_artifact_root" ]]; then
          reject_worker_path "$flag must stay inside its worker-owned root"
        fi
        resolved="$repo_root/$value"
        ;;
      *)
        reject_worker_path "$flag must stay inside its worker-owned root"
        ;;
    esac
    relative="${resolved#"$root"/}"
    if [[ -z "$relative" || "$relative" == */* ||
          "$relative" == "." || "$relative" == ".." ]]; then
      reject_worker_path "$flag must name a direct child of its worker-owned root"
    fi
    ensure_worker_tree_without_symlinks "$root"
    if [[ -L "$resolved" ]]; then
      reject_worker_path "$flag must not use a symlink"
    fi
    case "$access_mode" in
      input)
        if [[ ! -f "$resolved" ]]; then
          reject_worker_path "$flag must name an existing regular file"
        fi
        ;;
      output)
        if [[ -e "$resolved" && ! -f "$resolved" ]]; then
          reject_worker_path "$flag must name a regular output file"
        fi
        ;;
      *)
        reject_worker_path "Internal worker path policy is invalid"
        ;;
    esac
    resolved_worker_command[$((index + 1))]="$resolved"
    index=$((index + 1))
  done
}

bind_worker_directory_flags() {
  local flag="$1"
  local root="$2"
  local index value
  for ((index = worker_argument_start; index < ${#resolved_worker_command[@]}; index++)); do
    if [[ "${resolved_worker_command[$index]}" == "$flag="* ]]; then
      reject_worker_path "$flag requires a separate path value"
    fi
    if [[ "${resolved_worker_command[$index]}" != "$flag" ]]; then
      continue
    fi
    if ((index + 1 >= ${#resolved_worker_command[@]})) ||
       [[ "${resolved_worker_command[$((index + 1))]}" == --* ]]; then
      reject_worker_path "$flag requires one path"
    fi
    value="${resolved_worker_command[$((index + 1))]}"
    if [[ "$root" == "$worker_artifact_root" &&
          "$value" == "$worker_artifact_relative_root" ]]; then
      value="$worker_artifact_root"
    fi
    if [[ "$value" != "$root" ]]; then
      reject_worker_path "$flag must name its fixed worker-owned root"
    fi
    ensure_worker_tree_without_symlinks "$root"
    resolved_worker_command[$((index + 1))]="$root"
    index=$((index + 1))
  done
}

worker_command_has_flag() {
  local flag="$1"
  local index
  for ((index = worker_argument_start; index < ${#resolved_worker_command[@]}; index++)); do
    if [[ "${resolved_worker_command[$index]}" == "$flag" ||
          "${resolved_worker_command[$index]}" == "$flag="* ]]; then
      return 0
    fi
  done
  return 1
}

forbid_worker_flag() {
  local flag="$1"
  if worker_command_has_flag "$flag"; then
    reject_worker_path "$flag is forbidden in the route factory"
  fi
}

if [[ "$credential_profile" != "operator" ]]; then
  case "$approved_worker_script" in
    "$repo_root/cloud-sql/migrate/src/standard-route-jobs.ts")
      bind_worker_file_flags --output "$worker_artifact_root" output
      bind_worker_file_flags --artifact-path "$worker_artifact_root" input
      bind_worker_file_flags --result-file "$worker_artifact_root" input
      bind_worker_file_flags --review-packet "$worker_artifact_root" input
      bind_worker_file_flags --source-check "$worker_artifact_root" input
      ;;
    "$repo_root/.agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts")
      worker_requires_database=0
      bind_worker_file_flags --file "$worker_artifact_root" input
      bind_worker_directory_flags --directory "$worker_artifact_root"
      ;;
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/build_official_route_candidate.mts"|\
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts"|\
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/build_usgs_route_candidate.mts")
      bind_worker_file_flags --output "$worker_artifact_root" output
      ;;
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/merge_osm_loop_candidates.mts"|\
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/merge_route_loop_candidates.mts")
      worker_requires_database=0
      bind_worker_file_flags --outbound "$worker_artifact_root" input
      bind_worker_file_flags --return "$worker_artifact_root" input
      bind_worker_file_flags --output "$worker_artifact_root" output
      ;;
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts")
      worker_requires_database=0
      bind_worker_file_flags --geojson "$worker_artifact_root" input
      bind_worker_file_flags --output "$worker_artifact_root" output
      if worker_command_has_flag --tile-cache; then
        bind_worker_directory_flags --tile-cache "$worker_map_tile_root"
      else
        ensure_worker_tree_without_symlinks "$worker_map_tile_root"
        resolved_worker_command+=(--tile-cache "$worker_map_tile_root")
      fi
      ;;
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts")
      worker_requires_database=0
      bind_worker_file_flags --candidate "$worker_artifact_root" input
      if worker_command_has_flag --output-dir; then
        bind_worker_directory_flags --output-dir "$worker_terrain_root"
      else
        ensure_worker_tree_without_symlinks "$worker_terrain_root"
        resolved_worker_command+=(--output-dir "$worker_terrain_root")
      fi
      ;;
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/compare_route_reference.mts")
      worker_requires_database=0
      bind_worker_file_flags --candidate "$worker_artifact_root" input
      bind_worker_file_flags --reference "$worker_reference_root" input
      ;;
    "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts")
      bind_worker_file_flags --candidate "$worker_artifact_root" input
      bind_worker_file_flags --result-file "$worker_artifact_root" output
      forbid_worker_flag --upgrade-active-route
      forbid_worker_flag --replace-active-route
      forbid_worker_flag --replace-pending-route
      ensure_worker_tree_without_symlinks "$worker_terrain_root"
      export PEAKS_ELEVATION_SOURCE="terrain-cache"
      export PEAKS_TERRAIN_TILE_CACHE="$worker_terrain_root"
      unset PEAKS_ELEVATION_CACHE_DIR
      ;;
  esac
fi

if [[ "$credential_profile" != "operator" &&
      "$worker_requires_database" -eq 0 ]]; then
  unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASS DATABASE_URL PGPASSWORD
  unset PEAKS_ROUTE_FACTORY_DB_PASS PEAKS_ROUTE_REVIEW_DB_PASS PEAKS_ROUTE_DB_PASS
  exec "${resolved_worker_command[@]}"
fi

export DB_USER="$database_user"
case "$credential_profile" in
  factory) export PEAKS_ROUTE_FACTORY_DB_PASS="$selected_database_password" ;;
  reviewer) export PEAKS_ROUTE_REVIEW_DB_PASS="$selected_database_password" ;;
  operator) export PEAKS_ROUTE_DB_PASS="$selected_database_password" ;;
esac
source "$script_dir/load_route_db_password.sh" "$repo_root" "$credential_profile"
unset PEAKS_ROUTE_FACTORY_DB_PASS PEAKS_ROUTE_REVIEW_DB_PASS PEAKS_ROUTE_DB_PASS

if ! (echo >/dev/tcp/"$DB_HOST"/"$DB_PORT") >/dev/null 2>&1; then
  printf '%s\n' \
    "Database setup required: Cloud SQL Auth Proxy is not reachable at ${DB_HOST}:${DB_PORT}" \
    >&2
  exit 1
fi

exec "${resolved_worker_command[@]}"
