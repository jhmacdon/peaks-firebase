#!/bin/bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf '%s\n' "route_worker_environment.sh must be sourced" >&2
  exit 2
fi

sanitize_route_worker_environment() {
  PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  export PATH
  unset NODE_OPTIONS NODE_PATH BASH_ENV ENV
  unset TMPDIR TMP TEMP
  unset DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH LD_PRELOAD LD_LIBRARY_PATH
  unset ESBUILD_BINARY_PATH
  unset NPM_CONFIG_SCRIPT_SHELL npm_config_script_shell
  unset NPM_CONFIG_NODE_OPTIONS npm_config_node_options
  unset CURL_HOME XDG_CONFIG_HOME
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
  unset http_proxy https_proxy all_proxy no_proxy
  unset NODE_USE_ENV_PROXY
  unset NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED
  unset SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE REQUESTS_CA_BUNDLE
  unset PEAKS_OVERPASS_URL PEAKS_OSM_API_URL
  unset PEAKS_OVERPASS_USER_AGENT PEAKS_OSM_USER_AGENT
  unset PEAKS_PUBLIC_WEB_URL
  unset PEAKS_ELEVATION_SOURCE PEAKS_TERRAIN_TILE_CACHE
  unset PEAKS_ELEVATION_CACHE_DIR PEAKS_ALLOW_ROUTE_REQUEUE
}

select_route_worker_system_tmp() {
  local preferred="$1"
  local fallback="$2"
  if [[ -d "$preferred" && ! -L "$preferred" ]]; then
    printf '%s\n' "$preferred"
    return 0
  fi
  if [[ -d "$fallback" && ! -L "$fallback" ]]; then
    printf '%s\n' "$fallback"
    return 0
  fi
  printf '%s\n' "No trusted system temporary directory is available" >&2
  return 1
}

configure_route_database_target() {
  local credential_profile="$1"
  if [[ "$credential_profile" == "factory" ||
        "$credential_profile" == "reviewer" ]]; then
    if [[ -n "${PEAKS_ROUTE_DB_HOST:-}" ||
          -n "${PEAKS_ROUTE_DB_PORT:-}" ||
          -n "${PEAKS_ROUTE_DB_NAME:-}" ||
          -n "${DB_HOST:-}" ||
          -n "${DB_PORT:-}" ||
          -n "${DB_NAME:-}" ]]; then
      printf '%s\n' \
        "Database setup required: worker database target overrides are forbidden" \
        >&2
      return 1
    fi
    unset PEAKS_ROUTE_DB_HOST PEAKS_ROUTE_DB_PORT PEAKS_ROUTE_DB_NAME
    export DB_HOST="127.0.0.1"
    export DB_PORT="5432"
    export DB_NAME="peaks"
    return 0
  fi

  export DB_HOST="${PEAKS_ROUTE_DB_HOST:-${DB_HOST:-127.0.0.1}}"
  export DB_PORT="${PEAKS_ROUTE_DB_PORT:-${DB_PORT:-5432}}"
  export DB_NAME="${PEAKS_ROUTE_DB_NAME:-${DB_NAME:-peaks}}"
}
