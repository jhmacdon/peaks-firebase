#!/usr/bin/env bash

route_job_validate_claim_stage() {
  local checkout_kind="$1"
  shift
  if [[ "${1:-}" != "claim" ]]; then
    return 0
  fi
  shift

  local stage=""
  local stage_count=0
  local index
  local claim_args=("$@")
  for ((index = 0; index < ${#claim_args[@]}; index++)); do
    if [[ "${claim_args[$index]}" != "--stage" ]]; then
      continue
    fi
    stage_count=$((stage_count + 1))
    if ((index + 1 >= ${#claim_args[@]})); then
      echo "--stage requires a value" >&2
      return 2
    fi
    stage="${claim_args[$((index + 1))]}"
  done
  if ((stage_count != 1)); then
    echo "worker claims require exactly one explicit --stage" >&2
    return 2
  fi

  case "$checkout_kind" in
    route-review)
      if [[ "$stage" != "review" ]]; then
        echo "the route-review checkout may claim only --stage review" >&2
        return 2
      fi
      ;;
    route-factory|route-factory-02|route-factory-03|route-factory-04|route-repair|canonical)
      case "$stage" in
        factory|research|import|publish|verify)
          ;;
        *)
          echo "general and repair checkouts cannot claim review; use --stage factory" >&2
          return 2
          ;;
      esac
      ;;
    *)
      echo "claims require an approved route worker checkout role" >&2
      return 2
      ;;
  esac
}
