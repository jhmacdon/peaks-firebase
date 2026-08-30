#!/bin/bash -p
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migrate_root="$(cd "$script_dir/.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "run-tsx.sh requires a TypeScript entrypoint" >&2
  exit 2
fi

tsx_loader="$migrate_root/node_modules/tsx/dist/loader.mjs"
if [ ! -f "$tsx_loader" ]; then
  echo "run-tsx.sh requires installed migration dependencies" >&2
  exit 1
fi

node_binary="$(command -v node || true)"
if [[ -z "$node_binary" || "$node_binary" != /* || ! -x "$node_binary" ]]; then
  echo "run-tsx.sh requires node on the trusted executable path" >&2
  exit 1
fi

exec "$node_binary" --import "$tsx_loader" "$@"
