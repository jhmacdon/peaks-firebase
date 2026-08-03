#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
factory_scripts="$repo_root/.agents/skills/peaks-route-factory/scripts"

# Run the shared guard before parsing or forwarding every queue command.
"$factory_scripts/worker_preflight.sh" >/dev/null
worker_id="$("$factory_scripts/resolve_worker_checkout.sh" "$repo_root")"
if [ "$worker_id" != "luna-route-elevation-01" ]; then
  echo "setup_required: elevation commands require the approved elevation checkout" >&2
  exit 1
fi

command="${1:-}"
if [ -z "$command" ]; then
  echo "usage: stats | claim --apply | heartbeat --lease-token TOKEN | process --route-id ID --lease-token TOKEN --apply | release --lease-token TOKEN --message TEXT | show [--route-id ID] [--state STATE]" >&2
  exit 2
fi
shift

valid_id() {
  case "$1" in
    ''|*[!A-Za-z0-9_.:@/-]*) return 1 ;;
    *) return 0 ;;
  esac
}

require_id() {
  if ! valid_id "${1:-}"; then
    echo "$2 requires a safe value" >&2
    exit 2
  fi
}

if [ "$command" = "stats" ]; then
  if [ "$#" -ne 0 ]; then
    echo "stats takes no arguments" >&2
    exit 2
  fi
  cli_args=(stats)
elif [ "$command" = "claim" ]; then
  if [ "$#" -ne 1 ] || [ "$1" != "--apply" ]; then
    echo "claim requires only --apply; --worker-id is not allowed" >&2
    exit 2
  fi
  cli_args=(claim --worker-id "$worker_id" --apply)
elif [ "$command" = "heartbeat" ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--lease-token" ]; then
    echo "heartbeat requires only --lease-token TOKEN" >&2
    exit 2
  fi
  require_id "$2" "--lease-token"
  cli_args=(heartbeat --lease-token "$2")
elif [ "$command" = "process" ]; then
  if [ "$#" -ne 5 ] || [ "$1" != "--route-id" ] || [ "$3" != "--lease-token" ] || [ "$5" != "--apply" ]; then
    echo "process requires --route-id ID --lease-token TOKEN --apply" >&2
    exit 2
  fi
  require_id "$2" "--route-id"
  require_id "$4" "--lease-token"
  cli_args=(process --route-id "$2" --lease-token "$4" --apply)
elif [ "$command" = "release" ]; then
  if [ "$#" -ne 4 ] || [ "$1" != "--lease-token" ] || [ "$3" != "--message" ]; then
    echo "release requires --lease-token TOKEN --message TEXT" >&2
    exit 2
  fi
  require_id "$2" "--lease-token"
  case "$4" in
    ''|*$'\n'*|*$'\r'*) echo "--message requires one short line" >&2; exit 2 ;;
  esac
  if [ "${#4}" -gt 240 ]; then
    echo "--message must be at most 240 characters" >&2
    exit 2
  fi
  cli_args=(release --lease-token "$2" --message "$4")
elif [ "$command" = "show" ]; then
  if [ "$#" -eq 0 ]; then
    cli_args=(show)
  elif [ "$#" -eq 2 ] && [ "$1" = "--route-id" ]; then
    require_id "$2" "--route-id"
    cli_args=(show --route-id "$2")
  elif [ "$#" -eq 2 ] && [ "$1" = "--state" ]; then
    case "$2" in queued|working|retry|blocked|complete|out_of_scope) ;; *) echo "invalid state" >&2; exit 2 ;; esac
    cli_args=(show --state "$2")
  elif [ "$#" -eq 4 ] && [ "$1" = "--route-id" ] && [ "$3" = "--state" ]; then
    require_id "$2" "--route-id"
    case "$4" in queued|working|retry|blocked|complete|out_of_scope) ;; *) echo "invalid state" >&2; exit 2 ;; esac
    cli_args=(show --route-id "$2" --state "$4")
  elif [ "$#" -eq 4 ] && [ "$1" = "--state" ] && [ "$3" = "--route-id" ]; then
    case "$2" in queued|working|retry|blocked|complete|out_of_scope) ;; *) echo "invalid state" >&2; exit 2 ;; esac
    require_id "$4" "--route-id"
    cli_args=(show --route-id "$4" --state "$2")
  else
    echo "show accepts --route-id ID, --state STATE, or both once" >&2
    exit 2
  fi
else
  echo "unknown elevation queue command: $command" >&2
  exit 2
fi

exec "$factory_scripts/with_route_db.sh" \
  npm --prefix "$repo_root/cloud-sql/migrate" run routes:elevation-jobs -- "${cli_args[@]}"
