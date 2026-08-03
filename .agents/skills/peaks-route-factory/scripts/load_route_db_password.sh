#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf '%s\n' "load_route_db_password.sh must be sourced" >&2
  exit 2
fi

repo_root="${1:-}"
if [[ -z "$repo_root" ]]; then
  printf '%s\n' "Database setup required: repository root is missing" >&2
  return 1
fi

export DB_PASS="${PEAKS_ROUTE_DB_PASS:-${DB_PASS:-}}"
if [[ -n "$DB_PASS" ]]; then
  return 0
fi

credential_file="${PEAKS_ROUTE_DB_PASSWORD_FILE:-$(cd "$repo_root/.." && pwd)/.peaks-route-db-password}"
if [[ -e "$credential_file" ]]; then
  if [[ -L "$credential_file" || ! -f "$credential_file" ]]; then
    printf '%s\n' "Database setup required: password cache must be a regular file" >&2
    return 1
  fi
  if file_mode="$(stat -f '%Lp' "$credential_file" 2>/dev/null)"; then
    file_owner="$(stat -f '%u' "$credential_file")"
  else
    file_mode="$(stat -c '%a' "$credential_file")"
    file_owner="$(stat -c '%u' "$credential_file")"
  fi
  if [[ "$file_mode" != "600" || "$file_owner" != "$(id -u)" ]]; then
    printf '%s\n' "Database setup required: password cache must be owned by this user with mode 600" >&2
    return 1
  fi
  if [[ "$(wc -l < "$credential_file" | tr -d '[:space:]')" -gt 1 ]]; then
    printf '%s\n' "Database setup required: password cache must contain one line" >&2
    return 1
  fi
  IFS= read -r DB_PASS < "$credential_file" || true
  export DB_PASS
fi

if [[ -z "$DB_PASS" ]]; then
  command -v gcloud >/dev/null 2>&1 || {
    printf '%s\n' "Database setup required: DB_PASS is unset and gcloud is unavailable" >&2
    return 1
  }
  if ! DB_PASS="$(
    gcloud secrets versions access latest \
      --secret=peaks-db-postgres-password \
      --project=donner-a8608 \
      2>/dev/null
  )"; then
    printf '%s\n' "Database setup required: password lookup failed" >&2
    return 1
  fi
  export DB_PASS
fi

if [[ -z "$DB_PASS" ]]; then
  printf '%s\n' "Database setup required: password lookup returned no value" >&2
  return 1
fi
