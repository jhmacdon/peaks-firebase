#!/bin/bash
set -euo pipefail

readonly LABEL="com.jhm.peaks-cloud-sql-proxy"
readonly INSTANCE="donner-a8608:us-central1:peaks-db"
readonly QUOTA_PROJECT="donner-a8608"
readonly LISTEN_ADDRESS="127.0.0.1"
readonly LISTEN_PORT="5432"
readonly HEALTH_PORT="9090"
readonly DOMAIN="gui/$(id -u)"
readonly AGENT_DIR="${HOME}/Library/LaunchAgents"
readonly AGENT_PATH="${AGENT_DIR}/${LABEL}.plist"
readonly LOG_DIR="${HOME}/Library/Logs/Peaks"
readonly LOG_PATH="${LOG_DIR}/cloud-sql-proxy.log"

proxy_binary() {
  if [[ -x /opt/homebrew/bin/cloud-sql-proxy ]]; then
    printf '%s\n' /opt/homebrew/bin/cloud-sql-proxy
    return
  fi
  command -v cloud-sql-proxy || {
    printf '%s\n' "cloud-sql-proxy is not installed" >&2
    exit 1
  }
}

ready() {
  /usr/bin/curl --fail --silent \
    "http://${LISTEN_ADDRESS}:${HEALTH_PORT}/readiness" >/dev/null
}

status() {
  launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || {
    printf '%s\n' "${LABEL} is not loaded" >&2
    exit 1
  }
  ready || {
    printf '%s\n' "${LABEL} is loaded but not ready" >&2
    exit 1
  }
  printf '%s\n' "${LABEL} is ready on ${LISTEN_ADDRESS}:${LISTEN_PORT}"
}

install_agent() {
  local proxy_path temp_dir temp_plist
  proxy_path="$(proxy_binary)"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/peaks-cloud-sql-proxy.XXXXXX")"
  temp_plist="${temp_dir}/${LABEL}.plist"

  mkdir -p "${AGENT_DIR}" "${LOG_DIR}"
  cat >"${temp_plist}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${proxy_path}</string>
    <string>${INSTANCE}</string>
    <string>--address</string>
    <string>${LISTEN_ADDRESS}</string>
    <string>--port</string>
    <string>${LISTEN_PORT}</string>
    <string>--quota-project</string>
    <string>${QUOTA_PROJECT}</string>
    <string>--health-check</string>
    <string>--http-address</string>
    <string>${LISTEN_ADDRESS}</string>
    <string>--http-port</string>
    <string>${HEALTH_PORT}</string>
    <string>--exit-zero-on-sigterm</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
PLIST

  /usr/bin/plutil -lint "${temp_plist}" >/dev/null
  /usr/bin/install -m 0644 "${temp_plist}" "${AGENT_PATH}"

  launchctl bootout "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "${DOMAIN}" "${AGENT_PATH}"
  launchctl kickstart -k "${DOMAIN}/${LABEL}"
  rm -f "${temp_plist}"
  rmdir "${temp_dir}"
}

wait_until_ready() {
  local attempt
  for attempt in $(seq 1 20); do
    if ready; then
      printf '%s\n' "${LABEL} is ready on ${LISTEN_ADDRESS}:${LISTEN_PORT}"
      return
    fi
    sleep 1
  done

  printf '%s\n' "${LABEL} did not become ready; recent log output:" >&2
  /usr/bin/tail -n 40 "${LOG_PATH}" >&2 || true
  exit 1
}

case "${1:-ensure}" in
  ensure)
    install_agent
    wait_until_ready
    ;;
  status)
    status
    ;;
  *)
    printf '%s\n' "Usage: $0 [ensure|status]" >&2
    exit 2
    ;;
esac
